import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';

// Drum sample URLs (using Tone.js built-in samples)
const DRUM_SAMPLES = {
  kick: 'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
  snare: 'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
  hihat: 'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
};

const SYNTH_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const STEPS = 16;
const INSTRUMENTS = ['kick', 'snare', 'hihat'];

function BeatStudio({ onBeatReady, disabled }) {
  // Sequencer state
  const [drumPattern, setDrumPattern] = useState(() => {
    const pattern = {};
    INSTRUMENTS.forEach(inst => {
      pattern[inst] = Array(STEPS).fill(false);
    });
    return pattern;
  });
  
  const [melodyPattern, setMelodyPattern] = useState(() => 
    Array(STEPS).fill(null).map(() => [])
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
  
  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragAction, setDragAction] = useState(null); // 'add' or 'remove'
  const isDraggingRef = useRef(false);
  const dragActionRef = useRef(null);
  const lastDragCellRef = useRef(null);
  
  // Refs for Tone.js objects
  const drumPlayersRef = useRef(null);
  const synthRef = useRef(null);
  const sequenceRef = useRef(null);
  const drumVolumesRef = useRef({});
  const synthVolumeRef = useRef(null);

  // Initialize Tone.js
  const initAudio = useCallback(async () => {
    if (audioReady) return;
    
    await Tone.start();
    
    // Create drum players with individual volumes
    const players = {};
    INSTRUMENTS.forEach(inst => {
      const vol = new Tone.Volume(volumes[inst]).toDestination();
      drumVolumesRef.current[inst] = vol;
      players[inst] = new Tone.Player(DRUM_SAMPLES[inst]).connect(vol);
    });
    drumPlayersRef.current = players;
    
    // Create synth with volume
    const synthVol = new Tone.Volume(volumes.synth).toDestination();
    synthVolumeRef.current = synthVol;
    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.4 }
    }).connect(synthVol);
    
    // Wait for samples to load
    await Tone.loaded();
    setAudioReady(true);
  }, [audioReady, volumes]);

  // Update BPM
  useEffect(() => {
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

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

    // Create new sequence
    sequenceRef.current = new Tone.Sequence(
      (time, step) => {
        setCurrentStep(step);
        
        // Play drums
        INSTRUMENTS.forEach(inst => {
          if (drumPattern[inst][step] && drumPlayersRef.current?.[inst]) {
            drumPlayersRef.current[inst].start(time);
          }
        });
        
        // Play melody (chord support)
        const notes = melodyPattern[step];
        if (notes && notes.length > 0 && synthRef.current) {
          synthRef.current.triggerAttackRelease(notes, '8n', time);
        }
      },
      [...Array(STEPS).keys()],
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
  }, [audioReady, drumPattern, melodyPattern, isPlaying]);

  // Play/Pause
  const togglePlay = async () => {
    await initAudio();
    
    if (isPlaying) {
      Tone.Transport.stop();
      setCurrentStep(-1);
    } else {
      Tone.Transport.start();
    }
    setIsPlaying(!isPlaying);
  };

  // Stop
  const stopPlayback = () => {
    Tone.Transport.stop();
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

  // Set drum step to specific value
  const setDrumStep = (instrument, step, value) => {
    setDrumPattern(prev => ({
      ...prev,
      [instrument]: prev[instrument].map((v, i) => i === step ? value : v)
    }));
  };

  // Handle drum step mouse down (start drag)
  const handleDrumMouseDown = (instrument, step, e) => {
    e.preventDefault();
    
    const isActive = drumPattern[instrument][step];
    const action = isActive ? 'remove' : 'add';
    const setValue = action === 'add';
    
    setDragAction(action);
    setIsDragging(true);
    isDraggingRef.current = true;
    dragActionRef.current = action;
    lastDragCellRef.current = `${instrument}-${step}`;
    
    // Apply the action immediately
    setDrumStep(instrument, step, setValue);
    
    // Set up pointer tracking
    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!element) return;
      
      const instAttr = element.getAttribute('data-instrument');
      const stepAttr = element.getAttribute('data-step');
      
      if (instAttr !== null && stepAttr !== null) {
        const currentStep = parseInt(stepAttr);
        const cellKey = `${instAttr}-${currentStep}`;
        
        if (lastDragCellRef.current === cellKey) return;
        lastDragCellRef.current = cellKey;
        
        setDrumStep(instAttr, currentStep, setValue);
      }
    };
    
    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      handleMouseUp();
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  // Toggle melody step (chord support)
  const toggleMelodyStep = (noteIndex, step) => {
    const note = SYNTH_NOTES[noteIndex];
    setMelodyPattern(prev => 
      prev.map((notes, i) => {
        if (i !== step) return notes;
        // Toggle the note in the array
        const noteArray = [...notes];
        const noteIdx = noteArray.indexOf(note);
        if (noteIdx > -1) {
          // Remove note if it exists
          noteArray.splice(noteIdx, 1);
        } else {
          // Add note if it doesn't exist
          noteArray.push(note);
        }
        return noteArray;
      })
    );
  };

  // Add/remove a specific note
  const setMelodyNote = (noteIndex, step, shouldAdd) => {
    const note = SYNTH_NOTES[noteIndex];
    setMelodyPattern(prev => 
      prev.map((notes, i) => {
        if (i !== step) return notes;
        const noteArray = [...notes];
        const noteIdx = noteArray.indexOf(note);
        
        if (shouldAdd && noteIdx === -1) {
          // Add note if it doesn't exist
          noteArray.push(note);
        } else if (!shouldAdd && noteIdx > -1) {
          // Remove note if it exists
          noteArray.splice(noteIdx, 1);
        }
        return noteArray;
      })
    );
  };

  // Handle melody note mouse down (start drag)
  const handleMelodyMouseDown = (noteIndex, step, e) => {
    e.preventDefault(); // Prevent text selection during drag
    
    const note = SYNTH_NOTES[noteIndex];
    const notes = melodyPattern[step];
    const hasNote = notes.includes(note);
    
    // Determine if we're adding or removing based on current state
    const action = hasNote ? 'remove' : 'add';
    const shouldAdd = action === 'add';
    
    setDragAction(action);
    setIsDragging(true);
    isDraggingRef.current = true;
    dragActionRef.current = action;
    lastDragCellRef.current = `${noteIndex}-${step}`;
    
    // Apply the action immediately
    setMelodyNote(noteIndex, step, shouldAdd);
    
    // Set up pointer tracking for trackpad compatibility
    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      
      // Find element at pointer position
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!element) return;
      
      // Check if it's a melody button and get its data
      const noteAttr = element.getAttribute('data-note-index');
      const stepAttr = element.getAttribute('data-step');
      
      if (noteAttr !== null && stepAttr !== null) {
        const currentNoteIndex = parseInt(noteAttr);
        const currentStep = parseInt(stepAttr);
        const cellKey = `${currentNoteIndex}-${currentStep}`;
        
        // Avoid re-triggering on the same cell
        if (lastDragCellRef.current === cellKey) return;
        lastDragCellRef.current = cellKey;
        
        console.log('Dragging over cell:', cellKey, 'action:', dragActionRef.current);
        
        // Apply the action (add or remove based on initial action)
        setMelodyNote(currentNoteIndex, currentStep, shouldAdd);
      }
    };
    
    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      handleMouseUp();
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  // Handle mouse up anywhere (end drag)
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragAction(null);
    isDraggingRef.current = false;
    dragActionRef.current = null;
    lastDragCellRef.current = null;
  }, []);

  // Add global escape listener
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isDraggingRef.current) {
        handleMouseUp();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [handleMouseUp]);

  // Clear all
  const clearAll = () => {
    const emptyDrums = {};
    INSTRUMENTS.forEach(inst => {
      emptyDrums[inst] = Array(STEPS).fill(false);
    });
    setDrumPattern(emptyDrums);
    setMelodyPattern(Array(STEPS).fill(null).map(() => []));
  };

  // Export beat as WAV
  const exportBeat = async () => {
    if (isExporting) return;
    
    await initAudio();
    setIsExporting(true);
    stopPlayback();

    try {
      // Calculate duration based on BPM (16 steps at 16th notes = 1 bar)
      const barDuration = (60 / bpm) * 4; // 4 beats per bar
      const duration = barDuration * 2; // Export 2 bars for looping

      // Use Tone.Offline to render audio
      const buffer = await Tone.Offline(async ({ transport }) => {
        // Create players in offline context
        const offlinePlayers = {};
        const offlineVolumes = {};
        
        for (const inst of INSTRUMENTS) {
          const vol = new Tone.Volume(volumes[inst]).toDestination();
          offlineVolumes[inst] = vol;
          const player = new Tone.Player(DRUM_SAMPLES[inst]).connect(vol);
          offlinePlayers[inst] = player;
        }
        
        // Create synth in offline context
        const offlineSynthVol = new Tone.Volume(volumes.synth).toDestination();
        const offlineSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.4 }
        }).connect(offlineSynthVol);

        // Wait for samples to load
        await Tone.loaded();

        // Schedule all notes for 2 bars
        const stepDuration = (60 / bpm) / 4; // Duration of 16th note
        
        for (let bar = 0; bar < 2; bar++) {
          for (let step = 0; step < STEPS; step++) {
            const time = (bar * STEPS + step) * stepDuration;
            
            // Schedule drums
            INSTRUMENTS.forEach(inst => {
              if (drumPattern[inst][step]) {
                transport.schedule((t) => {
                  offlinePlayers[inst].start(t);
                }, time);
              }
            });
            
            // Schedule melody (chord support)
            const notes = melodyPattern[step];
            if (notes && notes.length > 0) {
              transport.schedule((t) => {
                offlineSynth.triggerAttackRelease(notes, '8n', t);
              }, time);
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
    if (preset === 'basic') {
      setDrumPattern({
        kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      });
    } else if (preset === 'hiphop') {
      setDrumPattern({
        kick: [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, true],
        hihat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      });
    } else if (preset === 'dance') {
      setDrumPattern({
        kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        hihat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
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
        <h3>🥁 Drums</h3>
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
              <div className="step-grid">
                {drumPattern[inst].map((active, step) => (
                  <button
                    key={step}
                    className={`step-btn ${active ? 'active' : ''} ${currentStep === step ? 'current' : ''} ${step % 4 === 0 ? 'beat-start' : ''}`}
                    data-instrument={inst}
                    data-step={step}
                    onMouseDown={(e) => handleDrumMouseDown(inst, step, e)}
                    style={{ userSelect: 'none', touchAction: 'none' }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Melody Sequencer */}
      <div className="sequencer-section">
        <h3>🎹 Melody</h3>
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
          <div className="piano-roll">
            {SYNTH_NOTES.slice().reverse().map((note, noteIdx) => (
              <div key={note} className="piano-row">
                <span className="note-label">{note}</span>
                <div className="step-grid">
                  {melodyPattern.map((activeNotes, step) => (
                    <button
                      key={step}
                      className={`step-btn melody-btn ${activeNotes.includes(note) ? 'active' : ''} ${currentStep === step ? 'current' : ''} ${step % 4 === 0 ? 'beat-start' : ''}`}
                      data-note-index={SYNTH_NOTES.length - 1 - noteIdx}
                      data-step={step}
                      onMouseDown={(e) => handleMelodyMouseDown(SYNTH_NOTES.length - 1 - noteIdx, step, e)}
                      style={{ userSelect: 'none', touchAction: 'none' }}
                    />
                  ))}
                </div>
              </div>
            ))}
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
