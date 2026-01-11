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
  
  // Beat mode: 'upload', 'create', or 'ai'
  const [beatMode, setBeatMode] = useState('upload');
  
  // Genre and mood for Eleven Music
  const [genre, setGenre] = useState('pop');
  const [mood, setMood] = useState('emotional');
  
  // AI Beat Generation
  const [aiBeatDescription, setAiBeatDescription] = useState('');
  
  // Voice Cloning
  const [voiceFiles, setVoiceFiles] = useState([]);
  const [voiceName, setVoiceName] = useState('');
  const [clonedVoiceId, setClonedVoiceId] = useState(null);
  const [isCloningVoice, setIsCloningVoice] = useState(false);
  
  const beatInputRef = useRef(null);
  const voiceInputRef = useRef(null);

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

  const generateAIBeat = async () => {
    if (!aiBeatDescription.trim()) {
      setError('Please enter a description for your beat');
      return;
    }

    setLoading('Generating AI beat... This may take up to 30 seconds.');
    setError('');

    try {
      const res = await fetch(`${API_BASE}/generate-music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: aiBeatDescription.trim(),
          musicLengthMs: 30000, // 30 seconds
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate beat');
      }

      setBeatUrl(data.url);
      setBeatFilename(data.filename);
      setLoading('');
    } catch (err) {
      setError(err.message);
      setLoading('');
    }
  };

  const handleVoiceSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setVoiceFiles(files);
      setError('');
    }
  };

  const cloneVoice = async () => {
    if (voiceFiles.length === 0) {
      setError('Please select at least one audio file');
      return;
    }
    if (!voiceName.trim()) {
      setError('Please enter a name for your voice');
      return;
    }

    setIsCloningVoice(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('name', voiceName.trim());
      voiceFiles.forEach(file => {
        formData.append('files', file);
      });

      const res = await fetch(`${API_BASE}/clone-voice`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      
      if (!res.ok) {
        console.error('Clone voice error response:', data);
        throw new Error(data.error || `Failed to clone voice (status: ${res.status})`);
      }

      console.log('Voice cloned successfully:', data);
      console.log('Voice ID:', data.voiceId);
      setClonedVoiceId(data.voiceId);
      setVoiceFiles([]);
      setVoiceName('');
      if (voiceInputRef.current) {
        voiceInputRef.current.value = '';
      }
      setIsCloningVoice(false);
    } catch (err) {
      console.error('Clone voice error:', err);
      setError(err.message || 'Failed to clone voice. Please check the backend logs for details.');
      setIsCloningVoice(false);
    }
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
      const requestBody = {
        lyrics: lyrics.trim(),
        genre,
        mood,
      };
      
      if (clonedVoiceId) {
        requestBody.voiceId = clonedVoiceId;
        console.log('Including cloned voice ID in request:', clonedVoiceId);
      } else {
        console.log('No cloned voice ID, using default AI voice');
      }
      
      const res = await fetch(`${API_BASE}/generate-vocals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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

  const downloadFile = async (url, filename) => {
    try {
      // Fetch the file as a blob to ensure it downloads properly
      const response = await fetch(url);
      if (!response.ok) throw new Error('File not found');
      
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename || 'ai-music-studio-track.mp3';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL after a delay
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
    } catch (err) {
      setError(`Failed to download file: ${err.message}`);
    }
  };

  const resetAll = () => {
    setBeatFile(null);
    setBeatUrl('');
    setBeatFilename('');
    setVocalUrl('');
    setVocalFilename('');
    setMixedUrl('');
    setLyrics('');
    setVoiceFiles([]);
    setVoiceName('');
    setClonedVoiceId(null);
    setError('');
    if (beatInputRef.current) {
      beatInputRef.current.value = '';
    }
    if (voiceInputRef.current) {
      voiceInputRef.current.value = '';
    }
  };

  const switchBeatMode = (mode) => {
    setBeatMode(mode);
    // Clear beat when switching modes
    setBeatUrl('');
    setBeatFilename('');
    setBeatFile(null);
    setAiBeatDescription('');
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
                <button 
                  className={`mode-btn ${beatMode === 'ai' ? 'active' : ''}`}
                  onClick={() => switchBeatMode('ai')}
                >
                  🤖 AI Generate Beat
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

              {/* AI Generate Mode */}
              {beatMode === 'ai' && (
                <div className="ai-beat-section">
                  <label className="label">Describe your beat:</label>
                  <textarea
                    value={aiBeatDescription}
                    onChange={(e) => setAiBeatDescription(e.target.value)}
                    placeholder="e.g., 'A chill lo-fi hip hop beat with smooth piano and soft drums'
or 'An energetic electronic dance beat with heavy bass and synth melodies'
or 'A laid-back jazz beat with saxophone and brushed drums'"
                    className="lyrics-input"
                    rows={4}
                  />
                  <div className="generate-hint" style={{ marginTop: '8px', marginBottom: '12px' }}>
                    💡 Describe the style, genre, instruments, mood, or tempo you want
                  </div>
                  <button 
                    onClick={generateAIBeat} 
                    disabled={!aiBeatDescription.trim() || loading}
                    className="btn btn-primary"
                  >
                    🎵 Generate Beat
                  </button>
                </div>
              )}

              {/* Beat Preview (shown for all modes when beat is ready) */}
              {beatUrl && (
                <div className="audio-preview beat-ready">
                  <span className="preview-label">✅ Beat Ready:</span>
                  <audio controls src={beatUrl} />
                </div>
              )}
            </div>
          </section>

          {/* Step 2: Enter Lyrics */}
          <section className="card card-wide">
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

          {/* Step 3: Clone Your Voice (Optional) */}
          <section className="card card-wide">
            <div className="card-header">
              <span className="step-number">3</span>
              <h2>Clone Your Voice (Optional)</h2>
            </div>
            <div className="card-content">
              <div className="generate-hint" style={{ marginBottom: '1rem' }}>
                💡 Upload audio samples of your voice to create a clone. Use your cloned voice to generate vocals in your own voice!
              </div>
              
              <label className="label">Voice Name:</label>
              <input
                type="text"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                placeholder="e.g., My Voice, John's Voice"
                className="lyrics-input"
                style={{ marginBottom: '1rem', padding: '0.75rem' }}
                disabled={!!clonedVoiceId || isCloningVoice}
              />

              <label className="label">Audio Files (MP3, WAV, M4A, OGG):</label>
              <div className="file-upload" style={{ marginBottom: '1rem' }}>
                <input
                  ref={voiceInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg"
                  onChange={handleVoiceSelect}
                  multiple
                  id="voice-input"
                  disabled={!!clonedVoiceId || isCloningVoice}
                />
                <label htmlFor="voice-input" className="file-label">
                  {voiceFiles.length > 0 
                    ? `${voiceFiles.length} file(s) selected: ${voiceFiles.map(f => f.name).join(', ')}`
                    : 'Choose audio file(s) - at least 30 seconds recommended'}
                </label>
              </div>

              {clonedVoiceId ? (
                <div className="audio-preview beat-ready">
                  <span className="preview-label">✅ Voice Cloned Successfully!</span>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                    Your voice is ready to use. Proceed to Step 4 to generate vocals.
                  </p>
                </div>
              ) : (
                <button 
                  onClick={cloneVoice} 
                  disabled={voiceFiles.length === 0 || !voiceName.trim() || isCloningVoice || loading}
                  className="btn btn-primary"
                >
                  {isCloningVoice ? '🔄 Cloning Voice...' : '🎤 Clone Voice'}
                </button>
              )}
            </div>
          </section>

          {/* Step 4: Choose Style & Generate */}
          <section className="card card-wide">
            <div className="card-header">
              <span className="step-number">4</span>
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
                {clonedVoiceId 
                  ? '🎤 Using your cloned voice to generate vocals'
                  : '🎤 AI will generate vocals'}
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

          {/* Step 5: Mix & Download */}
          <section className="card card-wide">
            <div className="card-header">
              <span className="step-number">5</span>
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
