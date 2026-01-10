const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const router = express.Router();

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
    // Also allow files without extension (like blob uploads from beat studio)
    if (allowedTypes.includes(ext) || ext === '' || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only MP3, WAV, M4A, and OGG files are allowed'));
    }
  }
});

// Get available ElevenLabs voices
router.get('/voices', async (req, res, next) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey || apiKey === 'your_api_key_here') {
      return res.status(400).json({ 
        error: 'ElevenLabs API key not configured. Please add your key to backend/.env' 
      });
    }

    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${error}`);
    }

    const data = await response.json();
    
    // Return simplified voice list
    const voices = data.voices.map(voice => ({
      voice_id: voice.voice_id,
      name: voice.name,
      category: voice.category || 'custom'
    }));

    res.json({ voices });
  } catch (error) {
    next(error);
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

// Generate vocals using ElevenLabs
router.post('/generate-vocals', async (req, res, next) => {
  try {
    const { lyrics, voiceId } = req.body;
    
    if (!lyrics || !voiceId) {
      return res.status(400).json({ error: 'Lyrics and voiceId are required' });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey || apiKey === 'your_api_key_here') {
      return res.status(400).json({ 
        error: 'ElevenLabs API key not configured' 
      });
    }

    console.log(`Generating vocals for voice: ${voiceId}`);
    console.log(`Lyrics: ${lyrics.substring(0, 100)}...`);

    // Call ElevenLabs Text-to-Speech API
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: lyrics,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs error:', errorText);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    // Save the audio to a file
    const vocalFilename = `vocals-${uuidv4()}.mp3`;
    const vocalPath = path.join(tempDir, vocalFilename);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(vocalPath, buffer);

    console.log(`Vocals saved to: ${vocalFilename}`);

    res.json({
      message: 'Vocals generated successfully',
      filename: vocalFilename,
      url: `/api/files/${vocalFilename}`
    });
  } catch (error) {
    next(error);
  }
});

// Mix vocals with beat using ffmpeg
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

    // Use ffmpeg to mix audio
    // This overlays vocals onto the beat starting at timestamp 0
    // The amix filter combines both audio streams
    const ffmpegCommand = `ffmpeg -i "${beatPath}" -i "${vocalPath}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=0,volume=2[out]" -map "[out]" -y "${mixedPath}"`;

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
