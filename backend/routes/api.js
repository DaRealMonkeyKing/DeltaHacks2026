const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { promisify } = require('util');
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

const execAsync = promisify(exec);
const router = express.Router();

// Lazy-initialized ElevenLabs client
let elevenlabs = null;

function getElevenLabsClient() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('ElevenLabs API key not configured. Please add your key to backend/.env');
  }
  if (!elevenlabs) {
    elevenlabs = new ElevenLabsClient({ apiKey });
  }
  return elevenlabs;
}

// Configure multer for file uploads
const tempDir = path.join(__dirname, '..', 'temp');
const storage = multer.diskStorage({
  destination: tempDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.mp3', '.wav', '.m4a', '.ogg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext) || ext === '' || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only MP3, WAV, M4A, and OGG files are allowed'));
    }
  }
});

// Upload beat file
router.post('/upload', upload.single('beat'), (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      message: 'Beat uploaded successfully',
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/api/files/${req.file.filename}`
    });
  } catch (error) {
    next(error);
  }
});

// Generate acapella vocals using Eleven Music + Stem Separation
router.post('/generate-vocals', async (req, res, next) => {
  try {
    const { lyrics, genre = 'pop', mood = 'emotional' } = req.body;
    
    if (!lyrics) {
      return res.status(400).json({ error: 'Lyrics are required' });
    }

    const client = getElevenLabsClient();

    // Format lyrics for the music prompt
    const formattedLyrics = lyrics
      .split(/\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    // Create a comprehensive music prompt for singing
    const musicPrompt = `A ${mood} ${genre} song with clear, expressive vocals singing these lyrics:

[Verse]
${formattedLyrics}

Style: ${genre} with ${mood} energy, studio-quality vocals, professional production, clear singing voice.`;

    console.log(`Generating singing with Eleven Music`);
    console.log(`Genre: ${genre}, Mood: ${mood}`);
    console.log(`Prompt preview: ${musicPrompt.substring(0, 200)}...`);

    // Step 1: Generate full song with Eleven Music
    console.log('Step 1: Generating full song with Eleven Music...');
    
    const audio = await client.music.compose({
      prompt: musicPrompt,
      musicLengthMs: 30000,  // 30 seconds
      forceInstrumental: false,  // We want vocals
    });

    // Save the full song temporarily
    const fullSongFilename = `fullsong-${uuidv4()}.mp3`;
    const fullSongPath = path.join(tempDir, fullSongFilename);
    
    // Convert the readable stream to a buffer and save
    const reader = audio.getReader();
    const chunks = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const fullSongBuffer = Buffer.concat(chunks);
    fs.writeFileSync(fullSongPath, fullSongBuffer);
    console.log(`Full song saved to: ${fullSongFilename}`);

    // Step 2: Use stem separation to extract vocals only (acapella)
    console.log('Step 2: Extracting acapella vocals using stem separation...');
    
    const stemResponse = await client.music.separateStems({
      file: fullSongBuffer,
      stemVariationId: 'two_stems_v1'  // Separates into vocals + instrumental
    });

    // The response is a tar.gz file containing the stems
    const stemReader = stemResponse.getReader();
    const stemChunks = [];
    
    while (true) {
      const { done, value } = await stemReader.read();
      if (done) break;
      stemChunks.push(value);
    }
    
    const tarBuffer = Buffer.concat(stemChunks);
    
    // Save the tar.gz and extract vocals
    const tarFilename = `stems-${uuidv4()}.tar.gz`;
    const tarPath = path.join(tempDir, tarFilename);
    fs.writeFileSync(tarPath, tarBuffer);
    
    // Extract the tar.gz
    const extractDir = path.join(tempDir, `extract-${uuidv4()}`);
    fs.mkdirSync(extractDir, { recursive: true });
    
    await execAsync(`tar -xzf "${tarPath}" -C "${extractDir}"`);
    
    // Find the vocals file in the extracted contents
    const vocalFilename = `vocals-${uuidv4()}.mp3`;
    const vocalPath = path.join(tempDir, vocalFilename);
    
    // Search for vocals file recursively
    const findVocalsFile = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          const found = findVocalsFile(filePath);
          if (found) return found;
        } else if (file.toLowerCase().includes('vocal') && 
                   (file.endsWith('.mp3') || file.endsWith('.wav'))) {
          return filePath;
        }
      }
      return null;
    };
    
    const vocalsFile = findVocalsFile(extractDir);
    
    if (vocalsFile) {
      // Copy the vocals file to our expected location
      fs.copyFileSync(vocalsFile, vocalPath);
      console.log(`Acapella vocals extracted from: ${vocalsFile}`);
    } else {
      // Fallback: if no vocals file found, use the full song
      console.log('Warning: Could not find vocals stem, using full song');
      fs.copyFileSync(fullSongPath, vocalPath);
    }
    
    // Clean up temporary files
    try {
      fs.unlinkSync(fullSongPath);
      fs.unlinkSync(tarPath);
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (e) {
      console.log('Cleanup warning:', e.message);
    }

    console.log(`Acapella vocals saved to: ${vocalFilename}`);

    res.json({
      message: 'Acapella vocals generated successfully',
      filename: vocalFilename,
      url: `/api/files/${vocalFilename}`
    });
  } catch (error) {
    console.error('Eleven Music error:', error);
    const errorMessage = error.body?.detail?.message || error.message || 'Failed to generate vocals';
    return res.status(500).json({ error: errorMessage });
  }
});

// Mix vocals with beat using ffmpeg (loops beat to match vocal length)
router.post('/mix', async (req, res, next) => {
  try {
    const { beatFilename, vocalFilename } = req.body;

    if (!beatFilename || !vocalFilename) {
      return res.status(400).json({ 
        error: 'beatFilename and vocalFilename are required' 
      });
    }

    const beatPath = path.join(tempDir, beatFilename);
    const vocalPath = path.join(tempDir, vocalFilename);

    // Verify files exist
    if (!fs.existsSync(beatPath)) {
      return res.status(404).json({ error: 'Beat file not found' });
    }
    if (!fs.existsSync(vocalPath)) {
      return res.status(404).json({ error: 'Vocal file not found' });
    }

    const mixedFilename = `mixed-${uuidv4()}.mp3`;
    const mixedPath = path.join(tempDir, mixedFilename);

    console.log('Mixing audio files...');
    console.log('Beat:', beatPath);
    console.log('Vocals:', vocalPath);

    // Get the duration of the vocals using ffprobe
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${vocalPath}"`;
    const { stdout: durationStr } = await execAsync(durationCmd);
    const vocalDuration = parseFloat(durationStr.trim());
    
    console.log(`Vocal duration: ${vocalDuration} seconds`);

    // Use ffmpeg to loop the beat and mix with vocals
    // -stream_loop -1 loops the beat infinitely, then we trim to vocal duration
    const ffmpegCommand = `ffmpeg -stream_loop -1 -i "${beatPath}" -i "${vocalPath}" -filter_complex "[0:a]atrim=0:${vocalDuration},asetpts=PTS-STARTPTS[beat];[beat][1:a]amix=inputs=2:duration=shortest:dropout_transition=0,volume=2[out]" -map "[out]" -t ${vocalDuration} -y "${mixedPath}"`;

    console.log('Running ffmpeg command:', ffmpegCommand);

    await execAsync(ffmpegCommand);

    console.log(`Mixed audio saved to: ${mixedFilename}`);

    res.json({
      message: 'Audio mixed successfully',
      filename: mixedFilename,
      url: `/api/files/${mixedFilename}`
    });
  } catch (error) {
    console.error('FFmpeg error:', error);
    if (error.message.includes('ffmpeg')) {
      return res.status(500).json({ 
        error: 'ffmpeg not found. Please install ffmpeg to mix audio.' 
      });
    }
    next(error);
  }
});

// Cleanup old files (optional endpoint)
router.delete('/cleanup', async (req, res, next) => {
  try {
    const files = fs.readdirSync(tempDir);
    let deleted = 0;

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtimeMs;
      
      // Delete files older than 1 hour
      if (age > 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }

    res.json({ message: `Cleaned up ${deleted} old files` });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
