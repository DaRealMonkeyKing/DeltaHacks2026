import React, { useState, useRef } from 'react';
import BeatStudio from './BeatStudio';

const API_BASE = '/api';

function App() {
  // State
  const [lyrics, setLyrics] = useState('');
  const [beatFile, setBeatFile] = useState(null);
  const [beatUrl, setBeatUrl] = useState('');
  const [beatFilename, setBeatFilename] = useState('');
  const [vocalUrl, setVocalUrl] = useState('');
  const [vocalFilename, setVocalFilename] = useState('');
  const [mixedUrl, setMixedUrl] = useState('');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  
  // Beat mode: 'upload' or 'create'
  const [beatMode, setBeatMode] = useState('upload');
  
  // Genre and mood for Eleven Music
  const [genre, setGenre] = useState('pop');
  const [mood, setMood] = useState('emotional');
  
  const beatInputRef = useRef(null);

  const handleBeatSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setBeatFile(file);
      setError('');
    }
  };

  const uploadBeat = async () => {
    if (!beatFile) {
      setError('Please select a beat file first');
      return;
    }

    setLoading('Uploading beat...');
    setError('');

    try {
      const formData = new FormData();
      formData.append('beat', beatFile);

      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setBeatUrl(data.url);
      setBeatFilename(data.filename);
      setLoading('');
    } catch (err) {
      setError(err.message);
      setLoading('');
    }
  };

  // Callback when beat studio exports a beat
  const handleBeatReady = (url, filename) => {
    setBeatUrl(url);
    setBeatFilename(filename);
    setError('');
  };

  const generateVocals = async () => {
    if (!lyrics.trim()) {
      setError('Please enter some lyrics');
      return;
    }

    setLoading('Generating acapella vocals with AI... This may take up to 90 seconds.');
    setError('');
    setVocalUrl('');
    setMixedUrl('');

    try {
      const res = await fetch(`${API_BASE}/generate-vocals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics: lyrics.trim(),
          genre,
          mood,
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate vocals');
      }

      setVocalUrl(data.url);
      setVocalFilename(data.filename);
      setLoading('');
    } catch (err) {
      setError(err.message);
      setLoading('');
    }
  };

  const mixAudio = async () => {
    if (!beatFilename) {
      setError('Please upload or create a beat first');
      return;
    }
    if (!vocalFilename) {
      setError('Please generate vocals first');
      return;
    }

    setLoading('Mixing vocals with beat...');
    setError('');

    try {
      const res = await fetch(`${API_BASE}/mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beatFilename,
          vocalFilename,
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to mix audio');
      }

      setMixedUrl(data.url);
      setLoading('');
    } catch (err) {
      setError(err.message);
      setLoading('');
    }
  };

  const downloadFile = (url, filename) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'ai-music-studio-track.mp3';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetAll = () => {
    setBeatFile(null);
    setBeatUrl('');
    setBeatFilename('');
    setVocalUrl('');
    setVocalFilename('');
    setMixedUrl('');
    setLyrics('');
    setError('');
    if (beatInputRef.current) {
      beatInputRef.current.value = '';
    }
  };

  const switchBeatMode = (mode) => {
    setBeatMode(mode);
    // Clear beat when switching modes
    setBeatUrl('');
    setBeatFilename('');
    setBeatFile(null);
    if (beatInputRef.current) {
      beatInputRef.current.value = '';
    }
  };

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <div className="logo">
            <span className="logo-icon">♪</span>
            <h1>AI Music Studio</h1>
          </div>
          <p className="tagline">Create or upload a beat. Add lyrics. Let AI sing.</p>
        </header>

        {error && (
          <div className="error-banner">
            <span>⚠</span>
            {error}
            <button onClick={() => setError('')} className="error-close">×</button>
          </div>
        )}

        {loading && (
          <div className="loading-banner">
            <div className="spinner"></div>
            {loading}
          </div>
        )}

        <div className="main-grid">
          {/* Step 1: Beat (Upload or Create) */}
          <section className="card card-wide">
            <div className="card-header">
              <span className="step-number">1</span>
              <h2>Get Your Beat</h2>
            </div>
            <div className="card-content">
              {/* Mode Toggle */}
              <div className="mode-toggle">
                <button 
                  className={`mode-btn ${beatMode === 'upload' ? 'active' : ''}`}
                  onClick={() => switchBeatMode('upload')}
                >
                  📁 Upload Beat
                </button>
                <button 
                  className={`mode-btn ${beatMode === 'create' ? 'active' : ''}`}
                  onClick={() => switchBeatMode('create')}
                >
                  🎹 Create My Beat
                </button>
              </div>

              {/* Upload Mode */}
              {beatMode === 'upload' && (
                <div className="upload-section">
                  <div className="file-upload">
                    <input
                      ref={beatInputRef}
                      type="file"
                      accept=".mp3,.wav,.m4a,.ogg"
                      onChange={handleBeatSelect}
                      id="beat-input"
                    />
                    <label htmlFor="beat-input" className="file-label">
                      {beatFile ? beatFile.name : 'Choose MP3 or WAV file'}
                    </label>
                  </div>
                  <button 
                    onClick={uploadBeat} 
                    disabled={!beatFile || loading}
                    className="btn btn-primary"
                  >
                    Upload Beat
                  </button>
                </div>
              )}

              {/* Create Mode - Beat Studio */}
              {beatMode === 'create' && (
                <BeatStudio 
                  onBeatReady={handleBeatReady} 
                  disabled={!!loading}
                />
              )}

              {/* Beat Preview (shown for both modes when beat is ready) */}
              {beatUrl && (
                <div className="audio-preview beat-ready">
                  <span className="preview-label">✅ Beat Ready:</span>
                  <audio controls src={beatUrl} />
                </div>
              )}
            </div>
          </section>

          {/* Step 2: Enter Lyrics */}
          <section className="card">
            <div className="card-header">
              <span className="step-number">2</span>
              <h2>Enter Lyrics</h2>
            </div>
            <div className="card-content">
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Type or paste your lyrics here...

Example:
Walking through the city lights
Stars are shining so bright tonight
Every step I take feels right
This is where I belong"
                className="lyrics-input"
                rows={8}
              />
              <div className="char-count">
                {lyrics.length} characters
              </div>
            </div>
          </section>

          {/* Step 3: Choose Style & Generate */}
          <section className="card">
            <div className="card-header">
              <span className="step-number">3</span>
              <h2>Generate Vocals</h2>
            </div>
            <div className="card-content">
              {/* Genre Selection */}
              <label className="label">Genre:</label>
              <div className="style-selector">
                {['pop', 'r&b', 'hip-hop', 'rock', 'indie', 'soul', 'electronic'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`style-btn ${genre === g ? 'active' : ''}`}
                    onClick={() => setGenre(g)}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>

              {/* Mood Selection */}
              <label className="label">Mood:</label>
              <div className="style-selector">
                {['emotional', 'upbeat', 'chill', 'energetic', 'romantic', 'melancholic'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`style-btn ${mood === m ? 'active' : ''}`}
                    onClick={() => setMood(m)}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>

              <div className="generate-hint">
                🎤 AI will generate acapella vocals (voice only, no background music)
              </div>

              <button
                onClick={generateVocals}
                disabled={!lyrics.trim() || loading}
                className="btn btn-primary btn-large"
              >
                🎵 Generate AI Singing
              </button>
              
              {vocalUrl && (
                <div className="audio-preview">
                  <span className="preview-label">🎤 Acapella Vocal Preview:</span>
                  <audio controls src={vocalUrl} />
                </div>
              )}
            </div>
          </section>

          {/* Step 4: Mix & Download */}
          <section className="card card-wide">
            <div className="card-header">
              <span className="step-number">4</span>
              <h2>Mix & Download</h2>
            </div>
            <div className="card-content">
              <div className="mix-actions">
                <button
                  onClick={mixAudio}
                  disabled={!beatFilename || !vocalFilename || loading}
                  className="btn btn-accent"
                >
                  🎛️ Mix Vocals + Beat
                </button>
                {mixedUrl && (
                  <button
                    onClick={() => downloadFile(mixedUrl, 'ai-music-track.mp3')}
                    className="btn btn-success"
                  >
                    ⬇️ Download Final Track
                  </button>
                )}
                <button onClick={resetAll} className="btn btn-secondary">
                  🔄 Start Over
                </button>
              </div>
              {mixedUrl && (
                <div className="audio-preview final-preview">
                  <span className="preview-label">🎵 Final Mixed Track:</span>
                  <audio controls src={mixedUrl} />
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="footer">
          <p>Powered by Eleven Music AI • Beats by Tone.js • Mixed with FFmpeg</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
