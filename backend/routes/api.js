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

// Clone voice using ElevenLabs API
router.post('/clone-voice', upload.array('files', 10), async (req, res, next) => {
  try {
    console.log('Clone voice request received');
    console.log('Files:', req.files ? req.files.length : 0);
    console.log('Body:', req.body);
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one audio file is required' });
    }

    const { name, description } = req.body;
    
    console.log('Extracted name:', name);
    console.log('Extracted description:', description);
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Voice name is required' });
    }

    console.log(`Cloning voice: ${name}`);
    console.log(`Files: ${req.files.length}`);

    // Use form-data package for multipart/form-data
    const FormData = require('form-data');
    const formData = new FormData();
    
    formData.append('name', name.trim());
    if (description) {
      formData.append('description', description.trim());
    }
    
    // Add all files
    req.files.forEach(file => {
      const fileStream = fs.createReadStream(file.path);
      formData.append('files', fileStream, {
        filename: file.originalname,
        contentType: file.mimetype || 'audio/mpeg'
      });
    });

    // Make the API call using form-data with https
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const https = require('https');
    const url = require('url');
    
    const apiUrl = 'https://api.elevenlabs.io/v1/voices/add';
    const parsedUrl = url.parse(apiUrl);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        ...formData.getHeaders()
      }
    };

    // Use a promise to handle the request
    const responseData = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            console.log(`ElevenLabs API response status: ${res.statusCode}`);
            console.log(`Response data length: ${data.length}`);
            
            if (!data || data.trim() === '') {
              console.error('Empty response from ElevenLabs API');
              reject(new Error(`Empty response from ElevenLabs API (status: ${res.statusCode})`));
              return;
            }
            
            let jsonData;
            try {
              jsonData = JSON.parse(data);
              console.log('Parsed JSON response:', JSON.stringify(jsonData, null, 2));
            } catch (parseError) {
              console.error('Failed to parse response as JSON. Raw data:', data.substring(0, 500));
              reject(new Error(`Invalid JSON response from ElevenLabs API: ${parseError.message}`));
              return;
            }
            
            resolve({ 
              status: res.statusCode, 
              ok: res.statusCode >= 200 && res.statusCode < 300, 
              data: jsonData 
            });
          } catch (e) {
            console.error('Error in response handler:', e);
            reject(new Error(`Error processing response: ${e.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('HTTPS request error:', error);
        reject(new Error(`Network error: ${error.message}`));
      });
      
      // Handle form-data errors
      formData.on('error', (error) => {
        console.error('Form-data error:', error);
        reject(new Error(`Form data error: ${error.message}`));
      });
      
      try {
        formData.pipe(req);
      } catch (pipeError) {
        console.error('Pipe error:', pipeError);
        reject(new Error(`Failed to send request: ${pipeError.message}`));
      }
    });

    const apiResponse = responseData.data;
    const isOk = responseData.ok;

    if (!isOk) {
      // Clean up uploaded files on error
      req.files.forEach(file => {
        try { fs.unlinkSync(file.path); } catch (e) {}
      });
      console.error('Voice cloning API error:', apiResponse);
      throw new Error(apiResponse.detail?.message || apiResponse.message || `Failed to clone voice (status: ${responseData.status})`);
    }

    // Clean up uploaded files after successful cloning
    req.files.forEach(file => {
      try { fs.unlinkSync(file.path); } catch (e) {}
    });

    console.log('Voice cloning API response:', JSON.stringify(apiResponse, null, 2));
    
    // Handle different possible response structures
    const voiceId = apiResponse.voice_id || apiResponse.voiceId || apiResponse.id;
    const voiceName = apiResponse.name || name.trim();

    if (!voiceId) {
      console.error('No voice_id in response:', responseData);
      throw new Error('Voice cloning succeeded but no voice ID was returned');
    }

    console.log(`Voice cloned successfully: ${voiceId} (${voiceName})`);

    res.json({
      message: 'Voice cloned successfully',
      voiceId: voiceId,
      name: voiceName
    });
  } catch (error) {
    console.error('Voice cloning error:', error);
    console.error('Error stack:', error.stack);
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        try { fs.unlinkSync(file.path); } catch (e) {}
      });
    }
    const errorMessage = error.message || 'Failed to clone voice';
    console.error('Returning error to client:', errorMessage);
    return res.status(500).json({ error: errorMessage });
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

// Generate acapella vocals using Eleven Music + Stem Separation, or Text-to-Speech with cloned voice
router.post('/generate-vocals', async (req, res, next) => {
  try {
    const { lyrics, genre = 'pop', mood = 'emotional', voiceId } = req.body;
    
    console.log('Generate vocals request:', { 
      hasLyrics: !!lyrics, 
      genre, 
      mood, 
      voiceId: voiceId || 'none',
      voiceIdType: typeof voiceId 
    });
    
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

    const vocalFilename = `vocals-${uuidv4()}.mp3`;
    const vocalPath = path.join(tempDir, vocalFilename);

    // If voiceId is provided, use Text-to-Speech with cloned voice
    const hasVoiceId = voiceId && voiceId !== null && voiceId !== undefined && voiceId !== '' && voiceId !== 'null';
    
    if (hasVoiceId) {
      console.log(`Generating vocals using cloned voice: ${voiceId}`);
      console.log(`Voice ID type: ${typeof voiceId}, value: ${voiceId}`);
      
      try {
        // Use the ElevenLabs API directly for Text-to-Speech
        const apiKey = process.env.ELEVENLABS_API_KEY;
        const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        console.log(`Calling TTS API: ${ttsUrl}`);
        
        const response = await fetch(ttsUrl, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: formattedLyrics,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.5,
              use_speaker_boost: true
            }
          })
        });

        console.log(`TTS API response status: ${response.status}`);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          console.error('TTS API error:', errorData);
          throw new Error(errorData.detail?.message || errorData.message || 'Failed to generate vocals with cloned voice');
        }

        // Get the audio as a buffer
        const arrayBuffer = await response.arrayBuffer();
        const vocalBuffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(vocalPath, vocalBuffer);
        console.log(`Vocals saved to: ${vocalFilename} (${vocalBuffer.length} bytes)`);

        res.json({
          message: 'Vocals generated successfully with cloned voice',
          filename: vocalFilename,
          url: `/api/files/${vocalFilename}`
        });
        return;
      } catch (ttsError) {
        console.error('Error in Text-to-Speech generation:', ttsError);
        // Fall through to use Eleven Music API as fallback
        console.log('Falling back to Eleven Music API');
      }
    } else {
      console.log('No voiceId provided, using Eleven Music API');
    }

    // Otherwise, use Eleven Music API (original method)
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

    // Step 2: Try to use stem separation to extract vocals only (acapella)
    // If stem separation fails, we'll use the full song as fallback
    let stemSeparationSucceeded = false;
    
    try {
      console.log('Step 2: Attempting to extract acapella vocals using stem separation...');
      
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
      
      // Verify it's actually a tar.gz file
      if (tarBuffer.length > 0 && tarBuffer[0] === 0x1f && tarBuffer[1] === 0x8b) {
        // Save the tar.gz and extract vocals
        const tarFilename = `stems-${uuidv4()}.tar.gz`;
        const tarPath = path.join(tempDir, tarFilename);
        fs.writeFileSync(tarPath, tarBuffer);
        
        // Extract the tar.gz
        const extractDir = path.join(tempDir, `extract-${uuidv4()}`);
        fs.mkdirSync(extractDir, { recursive: true });
        
        try {
          await execAsync(`tar -xzf "${tarPath}" -C "${extractDir}"`);
          
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
            stemSeparationSucceeded = true;
            
            // Clean up stem separation temp files
            try {
              fs.unlinkSync(tarPath);
              fs.rmSync(extractDir, { recursive: true, force: true });
            } catch (e) {
              console.log('Cleanup warning:', e.message);
            }
          }
        } catch (tarError) {
          console.log('Tar extraction failed:', tarError.message);
          // Clean up on failure
          try {
            if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
            if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
          } catch (e) {}
        }
      } else {
        console.log('Response does not appear to be a valid tar.gz file');
      }
    } catch (stemError) {
      console.log('Stem separation failed, using full song:', stemError.message);
    }
    
    // Fallback: if stem separation failed, use the full song
    if (!stemSeparationSucceeded) {
      console.log('Using full song as vocals (stem separation unavailable)');
      fs.copyFileSync(fullSongPath, vocalPath);
    }
    
    // Clean up full song file
    try {
      fs.unlinkSync(fullSongPath);
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

// Generate instrumental beat using ElevenLabs Music API
router.post('/generate-music', async (req, res, next) => {
  try {
    const { description, musicLengthMs = 30000 } = req.body;
    
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const client = getElevenLabsClient();

    console.log(`Generating instrumental beat with Eleven Music`);
    console.log(`Description: ${description}`);
    console.log(`Length: ${musicLengthMs}ms`);

    // Generate instrumental music (no vocals)
    const audio = await client.music.compose({
      prompt: description.trim(),
      musicLengthMs: parseInt(musicLengthMs),
      forceInstrumental: true,  // Instrumental only, no vocals
    });

    // Save the generated beat
    const beatFilename = `beat-${uuidv4()}.mp3`;
    const beatPath = path.join(tempDir, beatFilename);
    
    // Convert the readable stream to a buffer and save
    const reader = audio.getReader();
    const chunks = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const beatBuffer = Buffer.concat(chunks);
    fs.writeFileSync(beatPath, beatBuffer);
    console.log(`Beat saved to: ${beatFilename}`);

    res.json({
      message: 'Beat generated successfully',
      filename: beatFilename,
      url: `/api/files/${beatFilename}`
    });
  } catch (error) {
    console.error('Music generation error:', error);
    const errorMessage = error.body?.detail?.message || error.message || 'Failed to generate beat';
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
