# 🎵 AI Music Studio

A minimal full-stack MVP that lets users create or upload a beat and have ElevenLabs AI sing vocals over it.

## Features

### 🎹 Beat Creation Options
- **Create Your Own Beat** - In-browser beat studio with:
  - 🥁 Drum sequencer (kick, snare, hi-hats)
  - 🎹 Melody synth with piano roll
  - 🎚 Volume control for each track
  - 🎛 BPM tempo control (60-180)
  - 📋 Preset patterns (Basic, Hip-Hop, Dance)
  - 16-step sequencer grid
- **Upload a Beat** - Supports MP3, WAV, M4A, OGG

### 🎤 AI Vocals
- Enter lyrics for the AI to sing
- Select from available ElevenLabs voices
- Generate AI vocals with one click

### 🎵 Mixing & Export
- Automatically mix vocals with the beat using ffmpeg
- Preview beat, vocals, and final mix separately
- Download the final track as MP3

## Prerequisites

- **Node.js** (v18+)
- **npm** or **yarn**
- **ffmpeg** - Required for audio mixing

### Installing ffmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to PATH.

## Setup

### 1. Clone and Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the `backend` folder:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and add your ElevenLabs API key:

```
ELEVENLABS_API_KEY=your_api_key_here
PORT=3001
```

Get your API key from: https://elevenlabs.io/

### 3. Run the Application

**Terminal 1 - Start Backend:**
```bash
cd backend
npm start
```

**Terminal 2 - Start Frontend:**
```bash
cd frontend
npm start
```

The app will be available at http://localhost:3000

## Project Structure

```
/studio
├── backend/
│   ├── server.js           # Express server
│   ├── routes/
│   │   └── api.js          # API endpoints
│   ├── temp/               # Temporary file storage (auto-created)
│   ├── package.json
│   └── env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main React component
│   │   ├── App.css         # Styles
│   │   ├── BeatStudio.jsx  # In-browser beat creation studio
│   │   └── index.jsx       # Entry point
│   ├── public/
│   │   └── index.html
│   └── package.json
└── README.md
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voices` | GET | Get available ElevenLabs voices |
| `/api/upload` | POST | Upload a beat file |
| `/api/generate-vocals` | POST | Generate AI vocals from lyrics |
| `/api/mix` | POST | Mix vocals with beat using ffmpeg |
| `/api/files/:filename` | GET | Serve audio files |

## Tech Stack

- **Frontend:** React + Tone.js
- **Backend:** Node.js + Express
- **Audio Synthesis:** Tone.js (Web Audio API)
- **Audio Processing:** ffmpeg
- **AI Vocals:** ElevenLabs API

## How It Works

1. **Get Your Beat**
   - Toggle between "Upload Beat" and "Create My Beat"
   - If creating: Use the drum sequencer and melody piano roll
   - Click "Use This Beat" to export your creation

2. **Enter Lyrics**
   - Type or paste your lyrics in the text area

3. **Generate Vocals**
   - Select an AI voice from the dropdown
   - Click "Generate AI Vocals"

4. **Mix & Download**
   - Click "Mix Vocals + Beat" to combine
   - Preview the final track
   - Download as MP3

## License

MIT
