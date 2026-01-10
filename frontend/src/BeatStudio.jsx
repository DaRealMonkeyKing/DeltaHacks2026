import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  start,
  Volume,
  Player,
  PolySynth,
  Synth,
  Sequence,
  Transport,
  loaded,
  Offline,
} from 'tone';

// Drum sample URLs (using Tone.js built-in samples)
const DRUM_SAMPLES = {
  kick: 'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
  snare: 'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
  hihat: 'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
};

const SYNTH_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const INITIAL_STEPS = 16;
const MIN_STEPS = 4;
const MAX_STEPS = 64;
const INSTRUMENTS = ['kick', 'snare', 'hihat'];

function BeatStudio({ onBeatReady, disabled }) {
  // Separate step counts for drums and melody (columns)
  const [drumSteps, setDrumSteps] = useState(INITIAL_STEPS);
  const [melodySteps, setMelodySteps] = useState(INITIAL_STEPS);
  
  // Sequencer state
  const [drumPattern, setDrumPattern] = useState(() => {
    const pattern = {};
    INSTRUMENTS.forEach(inst => {
      pattern[inst] = Array(INITIAL_STEPS).fill(false);
    });
    return pattern;
  });
  
  const [melodyPattern, setMelodyPattern] = useState(() => 
    Array(INITIAL_STEPS).fill(null)
  );
  
  const [bpm, setBpm] = useState(120);
  const [volumes, setVolumes] = useState({
    kick: 0,
    snare: 0,
    hihat: -6,
    synth: -3,
  });
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isExporting, setIsExporting] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  
  // Refs for Tone.js objects
  const drumPlayersRef = useRef(null);
  const synthRef = useRef(null);
  const sequenceRef = useRef(null);
  const drumVolumesRef = useRef({});
  const synthVolumeRef = useRef(null);
  
  // Refs for syncing scroll between drum rows
  const drumGridWrappersRef = useRef(new Array(INSTRUMENTS.length).fill(null));
  const isScrollingRef = useRef(false);

  // Initialize Tone.js
  const initAudio = useCallback(async () => {
    if (audioReady) return;
    
    await start();
    
    // Create drum players with individual volumes
    const players = {};
    INSTRUMENTS.forEach(inst => {
      const vol = new Volume(volumes[inst]).toDestination();
      drumVolumesRef.current[inst] = vol;
      players[inst] = new Player(DRUM_SAMPLES[inst]).connect(vol);
    });
    drumPlayersRef.current = players;
    
    // Create synth with volume
    const synthVol = new Volume(volumes.synth).toDestination();
    synthVolumeRef.current = synthVol;
    synthRef.current = new PolySynth(Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.4 }
    }).connect(synthVol);
    
    // Wait for samples to load
    await loaded();
    setAudioReady(true);
  }, [audioReady, volumes]);

  // Update BPM
  useEffect(() => {
    Transport.bpm.value = bpm;
  }, [bpm]);

  // Sync scroll for all drum rows
  useEffect(() => {
    const drumWrappers = drumGridWrappersRef.current.filter(Boolean);
    
    if (drumWrappers.length === 0) return;

    const scrollHandlers = new Map();

    const handleScroll = (sourceElement) => {
      if (isScrollingRef.current) return;
      
      isScrollingRef.current = true;
      const scrollLeft = sourceElement.scrollLeft;
      
      // Sync all other drum rows to the same scroll position
      drumWrappers.forEach(wrapper => {
        if (wrapper !== sourceElement) {
          wrapper.scrollLeft = scrollLeft;
        }
      });
      
      // Use requestAnimationFrame to allow the scroll to complete
      requestAnimationFrame(() => {
        isScrollingRef.current = false;
      });
    };

    // Attach scroll listeners with stored handler references
    drumWrappers.forEach(wrapper => {
      const handler = () => handleScroll(wrapper);
      scrollHandlers.set(wrapper, handler);
      wrapper.addEventListener('scroll', handler);
    });

    // Cleanup
    return () => {
      scrollHandlers.forEach((handler, wrapper) => {
        wrapper.removeEventListener('scroll', handler);
      });
      scrollHandlers.clear();
    };
  }, [drumSteps, drumPattern]);

  // Update volumes
  useEffect(() => {
    INSTRUMENTS.forEach(inst => {
      if (drumVolumesRef.current[inst]) {
        drumVolumesRef.current[inst].volume.value = volumes[inst];
      }
    });
    if (synthVolumeRef.current) {
      synthVolumeRef.current.volume.value = volumes.synth;
    }
  }, [volumes]);

  // Create/update sequence
  useEffect(() => {
    if (!audioReady) return;

    // Dispose old sequence
    if (sequenceRef.current) {
      sequenceRef.current.dispose();
    }

    // Create new sequence - use max of drum and melody steps
    const maxSteps = Math.max(drumSteps, melodySteps);
    sequenceRef.current = new Sequence(
      (time, step) => {
        setCurrentStep(step);
        
        // Play drums (only if step is within drum pattern)
        if (step < drumSteps) {
          INSTRUMENTS.forEach(inst => {
            if (drumPattern[inst]?.[step] && drumPlayersRef.current?.[inst]) {
              drumPlayersRef.current[inst].start(time);
            }
          });
        }
        
        // Play melody (only if step is within melody pattern)
        if (step < melodySteps) {
          const note = melodyPattern[step];
          if (note && synthRef.current) {
            synthRef.current.triggerAttackRelease(note, '8n', time);
          }
        }
      },
      [...Array(maxSteps).keys()],
      '16n'
    );

    if (isPlaying) {
      sequenceRef.current.start(0);
    }

    return () => {
      if (sequenceRef.current) {
        sequenceRef.current.dispose();
      }
    };
  }, [audioReady, drumPattern, melodyPattern, isPlaying, drumSteps, melodySteps]);

  // Play/Pause
  const togglePlay = async () => {
    await initAudio();
    
    if (isPlaying) {
      Transport.stop();
      setCurrentStep(-1);
    } else {
      Transport.start();
    }
    setIsPlaying(!isPlaying);
  };

  // Stop
  const stopPlayback = () => {
    Transport.stop();
    setIsPlaying(false);
    setCurrentStep(-1);
  };

  // Toggle drum step
  const toggleDrumStep = (instrument, step) => {
    setDrumPattern(prev => ({
      ...prev,
      [instrument]: prev[instrument].map((v, i) => i === step ? !v : v)
    }));
  };

  // Toggle melody step
  const toggleMelodyStep = (noteIndex, step) => {
    const note = SYNTH_NOTES[noteIndex];
    setMelodyPattern(prev => 
      prev.map((v, i) => {
        if (i !== step) return v;
        return v === note ? null : note;
      })
    );
  };

  // Add column to drums
  const addDrumColumn = () => {
    if (drumSteps >= MAX_STEPS) return;
    
    // Stop playback when modifying columns
    if (isPlaying) {
      stopPlayback();
    }
    
    const newSteps = drumSteps + 1;
    setDrumSteps(newSteps);
    
    // Extend drum patterns with false
    setDrumPattern(prev => {
      const newPattern = {};
      INSTRUMENTS.forEach(inst => {
        newPattern[inst] = [...prev[inst], false];
      });
      return newPattern;
    });
  };

  // Remove column from drums
  const removeDrumColumn = () => {
    if (drumSteps <= MIN_STEPS) return;
    
    // Stop playback when modifying columns
    if (isPlaying) {
      stopPlayback();
    }
    
    const newSteps = drumSteps - 1;
    setDrumSteps(newSteps);
    
    // Remove last element from drum patterns
    setDrumPattern(prev => {
      const newPattern = {};
      INSTRUMENTS.forEach(inst => {
        newPattern[inst] = prev[inst].slice(0, -1);
      });
      return newPattern;
    });
  };

  // Add column to melody
  const addMelodyColumn = () => {
    if (melodySteps >= MAX_STEPS) return;
    
    // Stop playback when modifying columns
    if (isPlaying) {
      stopPlayback();
    }
    
    const newSteps = melodySteps + 1;
    setMelodySteps(newSteps);
    
    // Extend melody pattern with null
    setMelodyPattern(prev => [...prev, null]);
  };

  // Remove column from melody
  const removeMelodyColumn = () => {
    if (melodySteps <= MIN_STEPS) return;
    
    // Stop playback when modifying columns
    if (isPlaying) {
      stopPlayback();
    }
    
    const newSteps = melodySteps - 1;
    setMelodySteps(newSteps);
    
    // Remove last element from melody pattern
    setMelodyPattern(prev => prev.slice(0, -1));
  };

  // Clear all
  const clearAll = () => {
    const emptyDrums = {};
    INSTRUMENTS.forEach(inst => {
      emptyDrums[inst] = Array(drumSteps).fill(false);
    });
    setDrumPattern(emptyDrums);
    setMelodyPattern(Array(melodySteps).fill(null));
  };

  // Export beat as WAV
  const exportBeat = async () => {
    if (isExporting) return;
    
    await initAudio();
    setIsExporting(true);
    stopPlayback();

    try {
      // Calculate duration based on BPM and step count (use max of drum and melody steps)
      // Each step is a 16th note
      const stepDuration = (60 / bpm) / 4; // Duration of 16th note in seconds
      const repetitions = 2; // Export 2 repetitions for looping
      const maxSteps = Math.max(drumSteps, melodySteps);
      const duration = maxSteps * stepDuration * repetitions;

      // Use Tone.Offline to render audio
      const buffer = await Offline(async ({ transport }) => {
        // Create players in offline context
        const offlinePlayers = {};
        const offlineVolumes = {};
        
        for (const inst of INSTRUMENTS) {
          const vol = new Volume(volumes[inst]).toDestination();
          offlineVolumes[inst] = vol;
          const player = new Player(DRUM_SAMPLES[inst]).connect(vol);
          offlinePlayers[inst] = player;
        }
        
        // Create synth in offline context
        const offlineSynthVol = new Volume(volumes.synth).toDestination();
        const offlineSynth = new PolySynth(Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.4 }
        }).connect(offlineSynthVol);

        // Wait for samples to load
        await loaded();

        // Schedule all notes for 2 repetitions
        const repetitions = 2;
        const maxSteps = Math.max(drumSteps, melodySteps);
        for (let rep = 0; rep < repetitions; rep++) {
          for (let step = 0; step < maxSteps; step++) {
            const time = (rep * maxSteps + step) * stepDuration;
            
            // Schedule drums (only if step is within drum pattern)
            if (step < drumSteps) {
              INSTRUMENTS.forEach(inst => {
                if (drumPattern[inst][step]) {
                  transport.schedule((t) => {
                    offlinePlayers[inst].start(t);
                  }, time);
                }
              });
            }
            
            // Schedule melody (only if step is within melody pattern)
            if (step < melodySteps) {
              const note = melodyPattern[step];
              if (note) {
                transport.schedule((t) => {
                  offlineSynth.triggerAttackRelease(note, '8n', t);
                }, time);
              }
            }
          }
        }

        // Start transport
        transport.start(0);
      }, duration);
      
      // Convert to WAV
      const wavBlob = bufferToWav(buffer);
      
      // Send to backend
      const formData = new FormData();
      formData.append('beat', wavBlob, 'generated-beat.wav');
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload beat');
      }
      
      onBeatReady(data.url, data.filename);
      
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export beat: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Convert AudioBuffer to WAV Blob
  const bufferToWav = (toneBuffer) => {
    const audioBuffer = toneBuffer.get();
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const samples = audioBuffer.length;
    const dataSize = samples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Interleave channels and write samples
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }
    
    let offset = 44;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  };

  // Preset patterns
  const loadPreset = (preset) => {
    // Generate patterns based on current drum step count, repeating the 16-step pattern
    const generatePattern = (pattern16) => {
      const repeats = Math.ceil(drumSteps / 16);
      const fullPattern = [];
      for (let i = 0; i < repeats; i++) {
        fullPattern.push(...pattern16);
      }
      return fullPattern.slice(0, drumSteps);
    };
    
    if (preset === 'basic') {
      setDrumPattern({
        kick: generatePattern([true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false]),
        snare: generatePattern([false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false]),
        hihat: generatePattern([true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false]),
      });
    } else if (preset === 'hiphop') {
      setDrumPattern({
        kick: generatePattern([true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false]),
        snare: generatePattern([false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, true]),
        hihat: generatePattern([true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true]),
      });
    } else if (preset === 'dance') {
      setDrumPattern({
        kick: generatePattern([true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false]),
        snare: generatePattern([false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false]),
        hihat: generatePattern([false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false]),
      });
    }
  };

  return (
    <div className="beat-studio">
      {/* Controls */}
      <div className="studio-controls">
        <div className="transport-controls">
          <button 
            onClick={togglePlay} 
            className={`btn btn-transport ${isPlaying ? 'playing' : ''}`}
            disabled={disabled}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button onClick={stopPlayback} className="btn btn-transport" disabled={disabled}>
            ⏹ Stop
          </button>
          <button onClick={clearAll} className="btn btn-secondary btn-sm">
            🗑 Clear
          </button>
        </div>
        
        <div className="bpm-control">
          <label>BPM: {bpm}</label>
          <input
            type="range"
            min="60"
            max="180"
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
          />
        </div>
        
        <div className="preset-buttons">
          <span className="preset-label">Presets:</span>
          <button onClick={() => loadPreset('basic')} className="btn btn-preset">Basic</button>
          <button onClick={() => loadPreset('hiphop')} className="btn btn-preset">Hip-Hop</button>
          <button onClick={() => loadPreset('dance')} className="btn btn-preset">Dance</button>
        </div>
      </div>

      {/* Drum Sequencer */}
      <div className="sequencer-section">
        <div className="section-header">
          <h3>🥁 Drums</h3>
          <div className="column-controls">
            <label>Columns: {drumSteps}</label>
            <div className="column-buttons">
              <button 
                onClick={removeDrumColumn} 
                className="btn btn-sm btn-column"
                disabled={drumSteps <= MIN_STEPS || disabled}
                title="Remove column"
              >
                −
              </button>
              <button 
                onClick={addDrumColumn} 
                className="btn btn-sm btn-column"
                disabled={drumSteps >= MAX_STEPS || disabled}
                title="Add column"
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div className="sequencer-grid">
          {INSTRUMENTS.map((inst) => (
            <div key={inst} className="sequencer-row">
              <div className="instrument-label">
                <span className="inst-name">{inst}</span>
                <input
                  type="range"
                  min="-20"
                  max="6"
                  value={volumes[inst]}
                  onChange={(e) => setVolumes(v => ({...v, [inst]: Number(e.target.value)}))}
                  className="volume-slider"
                  title={`Volume: ${volumes[inst]}dB`}
                />
              </div>
              <div 
                className="step-grid-wrapper"
                ref={(el) => {
                  const index = INSTRUMENTS.indexOf(inst);
                  if (drumGridWrappersRef.current) {
                    drumGridWrappersRef.current[index] = el;
                  }
                }}
              >
                <div className="step-grid">
                  {drumPattern[inst].map((active, step) => (
                    <button
                      key={step}
                      className={`step-btn ${active ? 'active' : ''} ${currentStep === step ? 'current' : ''} ${step % 4 === 0 ? 'beat-start' : ''}`}
                      onClick={() => toggleDrumStep(inst, step)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Melody Sequencer */}
      <div className="sequencer-section">
        <div className="section-header">
          <h3>🎹 Melody</h3>
          <div className="column-controls">
            <label>Columns: {melodySteps}</label>
            <div className="column-buttons">
              <button 
                onClick={removeMelodyColumn} 
                className="btn btn-sm btn-column"
                disabled={melodySteps <= MIN_STEPS || disabled}
                title="Remove column"
              >
                −
              </button>
              <button 
                onClick={addMelodyColumn} 
                className="btn btn-sm btn-column"
                disabled={melodySteps >= MAX_STEPS || disabled}
                title="Add column"
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div className="melody-grid">
          <div className="instrument-label">
            <span className="inst-name">synth</span>
            <input
              type="range"
              min="-20"
              max="6"
              value={volumes.synth}
              onChange={(e) => setVolumes(v => ({...v, synth: Number(e.target.value)}))}
              className="volume-slider"
              title={`Volume: ${volumes.synth}dB`}
            />
          </div>
          <div className="piano-roll-wrapper">
            <div className="piano-roll">
              {SYNTH_NOTES.slice().reverse().map((note, noteIdx) => (
                <div key={note} className="piano-row">
                  <span className="note-label">{note}</span>
                  <div className="step-grid-wrapper">
                    <div className="step-grid">
                      {melodyPattern.map((activeNote, step) => (
                        <button
                          key={step}
                          className={`step-btn melody-btn ${activeNote === note ? 'active' : ''} ${currentStep === step ? 'current' : ''} ${step % 4 === 0 ? 'beat-start' : ''}`}
                          onClick={() => toggleMelodyStep(SYNTH_NOTES.length - 1 - noteIdx, step)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Export */}
      <div className="export-section">
        <button 
          onClick={exportBeat} 
          className="btn btn-primary btn-export"
          disabled={isExporting || disabled}
        >
          {isExporting ? '⏳ Exporting...' : '💾 Use This Beat'}
        </button>
        <p className="export-hint">Exports 2 bars of your beat and sends it to the mixer</p>
      </div>
    </div>
  );
}

export default BeatStudio;
