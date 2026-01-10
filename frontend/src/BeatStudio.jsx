import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';

const DRUM_SAMPLES = {
  kick: 'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
  snare: 'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
  hihat: 'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
  clap: '/Sound/clap.wav',
  snap: '/Sound/snap.wav',
  '808': '/Sound/808.wav',
  tick: '/Sound/tick.wav',
  cymbal: '/Sound/cymbal.wav'
};

const SYNTH_NOTES = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5'];
const MIN_STEPS = 4;
const MAX_STEPS = 32;
const INITIAL_STEPS = 16;
const INSTRUMENTS = ['kick', 'snare', 'hihat', 'clap', 'snap', '808', 'tick', 'cymbal'];

function BeatStudio({ onBeatReady, disabled }) {
  const [drumSteps, setDrumSteps] = useState(INITIAL_STEPS);
  const [melodySteps, setMelodySteps] = useState(INITIAL_STEPS);
  const [drumPattern, setDrumPattern] = useState(() => {
    const pattern = {};
    INSTRUMENTS.forEach(inst => { pattern[inst] = Array(INITIAL_STEPS).fill(false); });
    return pattern;
  });
  const [melodyPattern, setMelodyPattern] = useState(() => Array(INITIAL_STEPS).fill(null).map(() => []));
  const [bpm, setBpm] = useState(120);
  const [volumes, setVolumes] = useState({ kick: 0, snare: 0, hihat: -6, clap: -3, snap: -3, '808': -3, tick: -8, cymbal: -4, synth: -3 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isExporting, setIsExporting] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const lastDragCellRef = useRef(null);

  const drumPlayersRef = useRef(null);
  const synthRef = useRef(null);
  const sequenceRef = useRef(null);
  const drumVolumesRef = useRef({});
  const synthVolumeRef = useRef(null);
  const drumGridWrapperRef = useRef(null);
  const melodyGridWrapperRef = useRef(null);

  const initAudio = useCallback(async () => {
    if (audioReady) return;
    await Tone.start();

    const players = {};
    INSTRUMENTS.forEach(inst => {
      const vol = new Tone.Volume(volumes[inst]).toDestination();
      drumVolumesRef.current[inst] = vol;
      players[inst] = new Tone.Player(DRUM_SAMPLES[inst]).connect(vol);
    });
    await Promise.all(INSTRUMENTS.map(inst => players[inst].load(DRUM_SAMPLES[inst])));
    drumPlayersRef.current = players;

    const synthVol = new Tone.Volume(volumes.synth).toDestination();
    synthVolumeRef.current = synthVol;
    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.4 }
    }).connect(synthVol);

    await Tone.loaded();
    setAudioReady(true);
  }, [audioReady, volumes]);

  useEffect(() => {
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

  useEffect(() => {
    if (!audioReady) return;
    INSTRUMENTS.forEach(inst => {
      if (drumVolumesRef.current[inst]) {
        drumVolumesRef.current[inst].volume.value = volumes[inst];
      }
    });
    if (synthVolumeRef.current) {
      synthVolumeRef.current.volume.value = volumes.synth;
    }
  }, [volumes, audioReady]);

  useEffect(() => {
    if (!audioReady) return;
    if (sequenceRef.current) sequenceRef.current.dispose();
    const maxSteps = Math.max(drumSteps, melodySteps);
    sequenceRef.current = new Tone.Sequence(
      (time, step) => {
        setCurrentStep(step);
        if (step < drumSteps) {
          INSTRUMENTS.forEach(inst => {
            if (drumPattern[inst]?.[step] && drumPlayersRef.current?.[inst]) {
              // Nudge start time forward slightly to avoid duplicate time assertions in Tone.Player
              drumPlayersRef.current[inst].start(time + 0.0001);
            }
          });
        }
        if (step < melodySteps) {
          const notes = melodyPattern[step];
          if (notes && notes.length > 0 && synthRef.current) {
            synthRef.current.triggerAttackRelease(notes, '8n', time);
          }
        }
      },
      [...Array(maxSteps).keys()],
      '16n'
    );
    if (isPlaying) sequenceRef.current.start(0);
    return () => sequenceRef.current?.dispose();
  }, [audioReady, drumPattern, melodyPattern, isPlaying, drumSteps, melodySteps]);

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

  const stopPlayback = () => {
    Tone.Transport.stop();
    setIsPlaying(false);
    setCurrentStep(-1);
  };

  const setDrumStep = (instrument, step, value) => {
    setDrumPattern(prev => ({
      ...prev,
      [instrument]: prev[instrument].map((v, i) => (i === step ? value : v))
    }));
  };

  const handleDrumMouseDown = (instrument, step, e) => {
    e.preventDefault();
    const setValue = !drumPattern[instrument][step];
    setIsDragging(true);
    isDraggingRef.current = true;
    lastDragCellRef.current = `${instrument}-${step}`;
    setDrumStep(instrument, step, setValue);

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!element) return;
      const instAttr = element.getAttribute('data-instrument');
      const stepAttr = element.getAttribute('data-step');
      if (instAttr && stepAttr) {
        const key = `${instAttr}-${stepAttr}`;
        if (lastDragCellRef.current === key) return;
        lastDragCellRef.current = key;
        setDrumStep(instAttr, parseInt(stepAttr, 10), setValue);
      }
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      setIsDragging(false);
      isDraggingRef.current = false;
      lastDragCellRef.current = null;
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const setMelodyNote = (noteIndex, step, shouldAdd) => {
    const note = SYNTH_NOTES[noteIndex];
    setMelodyPattern(prev => prev.map((notes, i) => {
      if (i !== step) return notes;
      const noteArray = [...notes];
      const idx = noteArray.indexOf(note);
      if (shouldAdd && idx === -1) noteArray.push(note);
      else if (!shouldAdd && idx > -1) noteArray.splice(idx, 1);
      return noteArray;
    }));
  };

  const handleMelodyMouseDown = (noteIndex, step, e) => {
    e.preventDefault();
    const note = SYNTH_NOTES[noteIndex];
    const shouldAdd = !melodyPattern[step].includes(note);
    setIsDragging(true);
    isDraggingRef.current = true;
    lastDragCellRef.current = `${noteIndex}-${step}`;
    setMelodyNote(noteIndex, step, shouldAdd);

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const nIdx = element?.getAttribute('data-note-index');
      const sIdx = element?.getAttribute('data-step');
      if (nIdx !== null && sIdx !== null) {
        const key = `${nIdx}-${sIdx}`;
        if (lastDragCellRef.current === key) return;
        lastDragCellRef.current = key;
        setMelodyNote(parseInt(nIdx, 10), parseInt(sIdx, 10), shouldAdd);
      }
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      setIsDragging(false);
      isDraggingRef.current = false;
      lastDragCellRef.current = null;
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const addDrumColumn = () => {
    if (drumSteps >= MAX_STEPS) return;
    setDrumSteps(s => s + 1);
    setDrumPattern(prev => {
      const next = {};
      INSTRUMENTS.forEach(inst => { next[inst] = [...prev[inst], false]; });
      return next;
    });
  };

  const removeDrumColumn = () => {
    if (drumSteps <= MIN_STEPS) return;
    setDrumSteps(s => s - 1);
    setDrumPattern(prev => {
      const next = {};
      INSTRUMENTS.forEach(inst => { next[inst] = prev[inst].slice(0, -1); });
      return next;
    });
  };

  const addMelodyColumn = () => {
    if (melodySteps >= MAX_STEPS) return;
    setMelodySteps(s => s + 1);
    setMelodyPattern(prev => [...prev, []]);
  };

  const removeMelodyColumn = () => {
    if (melodySteps <= MIN_STEPS) return;
    setMelodySteps(s => s - 1);
    setMelodyPattern(prev => prev.slice(0, -1));
  };

  const clearAll = () => {
    const emptyDrums = {};
    INSTRUMENTS.forEach(inst => { emptyDrums[inst] = Array(drumSteps).fill(false); });
    setDrumPattern(emptyDrums);
    setMelodyPattern(Array(melodySteps).fill(null).map(() => []));
  };

  const generateBeat = () => {
    // Randomize BPM in musical ranges
    const bpmRanges = [
      [85, 95],   // Laid-back hip-hop
      [100, 115], // Mid-tempo groove
      [120, 135], // Dance/house
      [140, 155]  // Uptempo
    ];
    const range = bpmRanges[Math.floor(Math.random() * bpmRanges.length)];
    const newBpm = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
    setBpm(newBpm);

    const steps = 16;
    setDrumSteps(steps);
    setMelodySteps(steps);

    // Choose a groove style
    const grooveStyle = Math.random();
    const newDrumPattern = {};
    
    // Kick: Musical patterns based on groove
    newDrumPattern.kick = Array(steps).fill(false).map((_, i) => {
      // Always strong on beat 1
      if (i === 0) return true;
      
      if (grooveStyle < 0.33) {
        // Four-on-floor pattern
        return i % 4 === 0;
      } else if (grooveStyle < 0.66) {
        // Hip-hop pattern: 1 and 3, with occasional syncopation
        if (i === 8) return true; // Beat 3
        if (i === 6 && Math.random() > 0.7) return true; // Syncopation before 3
        if (i === 14 && Math.random() > 0.8) return true; // End syncopation
        return false;
      } else {
        // Broken beat pattern
        if (i === 8) return Math.random() > 0.5; // Sometimes on 3
        if (i === 3 && Math.random() > 0.6) return true; // Syncopation
        if (i === 10 && Math.random() > 0.7) return true; // Off-beat
        return false;
      }
    });

    // Snare: Solid backbeat with occasional ghost notes
    newDrumPattern.snare = Array(steps).fill(false).map((_, i) => {
      // Backbeat on 2 and 4 (steps 4 and 12)
      if (i === 4 || i === 12) return true;
      // Rare fills before backbeat
      if ((i === 11 || i === 3) && Math.random() > 0.85) return true;
      return false;
    });

    // Hi-hat: Consistent rhythm with musical variation
    const hihatPattern = Math.floor(Math.random() * 3);
    newDrumPattern.hihat = Array(steps).fill(false).map((_, i) => {
      if (hihatPattern === 0) {
        // Eighth notes (every 2 steps)
        return i % 2 === 0 || (i % 4 === 1 && Math.random() > 0.6);
      } else if (hihatPattern === 1) {
        // Sixteenth notes with swing
        return i % 2 === 0 || (i % 2 === 1 && Math.random() > 0.3);
      } else {
        // Quarter notes with accents
        return i % 4 === 0 || (i % 4 === 2 && Math.random() > 0.5);
      }
    });

    // Clap: Layer with snare on backbeat
    newDrumPattern.clap = Array(steps).fill(false).map((_, i) => {
      if ((i === 4 || i === 12) && Math.random() > 0.5) return true;
      return false;
    });

    // Snap: Percussion accents on off-beats
    newDrumPattern.snap = Array(steps).fill(false).map((_, i) => {
      if ([2, 6, 10, 14].includes(i) && Math.random() > 0.7) return true;
      return false;
    });

    // 808: Deep bass hits, complementing or replacing kick
    newDrumPattern['808'] = Array(steps).fill(false).map((_, i) => {
      if (grooveStyle < 0.33) {
        // Minimal 808 with four-on-floor
        return i === 0 || (i === 8 && Math.random() > 0.5);
      } else if (grooveStyle < 0.66) {
        // Hip-hop 808: syncopated bass
        if (i === 0) return true;
        if (i === 6 && Math.random() > 0.6) return true;
        if (i === 11 && Math.random() > 0.7) return true;
        return false;
      } else {
        // Trap-style 808 rolls
        if (i === 0 || i === 8) return true;
        if ([3, 7, 11, 15].includes(i) && Math.random() > 0.8) return true;
        return false;
      }
    });

    // Tick: Light metronome-style layer on quarters/eighths
    newDrumPattern.tick = Array(steps).fill(false).map((_, i) => {
      if (i % 4 === 0) return Math.random() > 0.1; // Quarter accents
      if (i % 2 === 0 && Math.random() > 0.7) return true; // Occasional 8ths
      return false;
    });

    // Cymbal: Occasional crashes on downbeats
    newDrumPattern.cymbal = Array(steps).fill(false).map((_, i) => {
      if (i === 0) return Math.random() > 0.4;
      if (i === 8 && Math.random() > 0.6) return true;
      return false;
    });

    setDrumPattern(newDrumPattern);

    // Generate melodic phrases with better musical structure
    const scales = {
      major: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5'],        // C major pentatonic
      minor: ['C4', 'D4', 'Eb4', 'G4', 'A4', 'C5'],       // C minor pentatonic (simulated)
      dorian: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'C5']  // More notes
    };
    
    const scaleChoice = ['major', 'minor', 'dorian'][Math.floor(Math.random() * 3)];
    const scale = scales[scaleChoice];
    
    // Create a melodic phrase structure (AABA or ABAB)
    const phraseType = Math.random() > 0.5 ? 'AABA' : 'ABAB';
    const melodyDensity = Math.random() * 0.3 + 0.4; // 0.4-0.7
    
    // Generate two 4-bar phrases
    const generatePhrase = (isDense) => {
      return Array(4).fill(null).map((_, i) => {
        const adjustedDensity = isDense ? melodyDensity * 1.2 : melodyDensity * 0.8;
        
        // Strong emphasis on downbeats
        if (i === 0 && Math.random() < 0.8) {
          const idx = Math.floor(Math.random() * (scale.length - 2)) + 1; // Avoid extremes on downbeat
          return [scale[idx]];
        }
        
        if (Math.random() > adjustedDensity) return [];
        
        // Melodic movement: prefer stepwise motion
        const lastNote = i > 0 ? scale[Math.floor(scale.length / 2)] : scale[2];
        const lastIndex = scale.indexOf(lastNote);
        const movement = Math.random();
        
        let noteIndex;
        if (movement < 0.4) {
          // Stepwise up
          noteIndex = Math.min(lastIndex + 1, scale.length - 1);
        } else if (movement < 0.8) {
          // Stepwise down
          noteIndex = Math.max(lastIndex - 1, 0);
        } else {
          // Jump
          noteIndex = Math.floor(Math.random() * scale.length);
        }
        
        const notes = [scale[noteIndex]];
        
        // Occasional harmony
        if (Math.random() > 0.85) {
          const harmonyIndex = Math.min(noteIndex + 2, scale.length - 1);
          notes.push(scale[harmonyIndex]);
        }
        
        return notes;
      });
    };

    const phraseA = generatePhrase(true);
    const phraseB = generatePhrase(false);
    
    let newMelodyPattern;
    if (phraseType === 'AABA') {
      newMelodyPattern = [...phraseA, ...phraseA, ...phraseB, ...phraseA];
    } else {
      newMelodyPattern = [...phraseA, ...phraseB, ...phraseA, ...phraseB];
    }

    setMelodyPattern(newMelodyPattern);
  };

  const exportBeat = async () => {
    if (isExporting) return;
    await initAudio();
    setIsExporting(true);
    stopPlayback();
    try {
      const maxSteps = Math.max(drumSteps, melodySteps);
      const stepDuration = (60 / bpm) / 4;
      const duration = stepDuration * maxSteps;

      const buffer = await Tone.Offline(async ({ transport }) => {
        const offlinePlayers = {};
        for (const inst of INSTRUMENTS) {
          const vol = new Tone.Volume(volumes[inst]).toDestination();
          offlinePlayers[inst] = new Tone.Player(DRUM_SAMPLES[inst]).connect(vol);
        }
        await Promise.all(INSTRUMENTS.map(inst => offlinePlayers[inst].load(DRUM_SAMPLES[inst])));
        const offlineSynthVol = new Tone.Volume(volumes.synth).toDestination();
        const offlineSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.4 }
        }).connect(offlineSynthVol);

        await Tone.loaded();
        for (let step = 0; step < maxSteps; step++) {
          const time = step * stepDuration;
          if (step < drumSteps) {
            INSTRUMENTS.forEach(inst => {
              if (drumPattern[inst][step]) {
                transport.schedule(t => offlinePlayers[inst].start(t + 0.0001), time);
              }
            });
          }
          if (step < melodySteps) {
            const notes = melodyPattern[step];
            if (notes && notes.length > 0) {
              transport.schedule(t => offlineSynth.triggerAttackRelease(notes, '8n', t), time);
            }
          }
        }
        transport.start(0);
      }, duration);

      const wavBlob = bufferToWav(buffer);
      const formData = new FormData();
      formData.append('beat', wavBlob, 'generated-beat.wav');
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload beat');
      onBeatReady(data.url, data.filename);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export beat: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const bufferToWav = (toneBuffer) => {
    const audioBuffer = toneBuffer.get();
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const samples = audioBuffer.length;
    const dataSize = samples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
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

    const channels = [];
    for (let i = 0; i < numChannels; i++) channels.push(audioBuffer.getChannelData(i));
    let offset = 44;
    for (let i = 0; i < samples; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        let sample = channels[channel][i];
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  return (
    <div className="beat-studio">
      <div className="studio-controls">
        <div className="transport-controls">
          <button onClick={togglePlay} className={`btn btn-transport ${isPlaying ? 'playing' : ''}`} disabled={disabled}>
            {isPlaying ? ' Pause' : ' Play'}
          </button>
          <button onClick={stopPlayback} className="btn btn-transport" disabled={disabled}> Stop</button>
          <button onClick={clearAll} className="btn btn-secondary btn-sm"> Clear</button>
          <button onClick={generateBeat} className="btn btn-primary btn-sm">🎲 Generate Beat</button>
        </div>
        <div className="bpm-control">
          <label>BPM: {bpm}</label>
          <input type="range" min="60" max="180" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
        </div>
      </div>

      <div className="sequencer-section">
        <h3> Drums</h3>
        <div className="row-controls">
          <button onClick={removeDrumColumn} className="btn btn-sm" disabled={drumSteps <= MIN_STEPS}>-</button>
          <span>{drumSteps} steps</span>
          <button onClick={addDrumColumn} className="btn btn-sm" disabled={drumSteps >= MAX_STEPS}>+</button>
        </div>
        <div className="step-grid-wrapper" ref={drumGridWrapperRef}>
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
                    onChange={(e) => setVolumes(v => ({ ...v, [inst]: Number(e.target.value) }))}
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
      </div>

      <div className="sequencer-section">
        <h3> Melody</h3>
        <div className="row-controls">
          <button onClick={removeMelodyColumn} className="btn btn-sm" disabled={melodySteps <= MIN_STEPS}>-</button>
          <span>{melodySteps} steps</span>
          <button onClick={addMelodyColumn} className="btn btn-sm" disabled={melodySteps >= MAX_STEPS}>+</button>
        </div>
        <div className="melody-grid">
          <div className="instrument-label">
            <span className="inst-name">synth</span>
            <input
              type="range"
              min="-20"
              max="6"
              value={volumes.synth}
              onChange={(e) => setVolumes(v => ({ ...v, synth: Number(e.target.value) }))}
              className="volume-slider"
              title={`Volume: ${volumes.synth}dB`}
            />
          </div>
          <div className="step-grid-wrapper" ref={melodyGridWrapperRef}>
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
      </div>

      <div className="export-section">
        <button onClick={exportBeat} className="btn btn-primary btn-export" disabled={isExporting || disabled}>
          {isExporting ? ' Exporting...' : ' Use This Beat'}
        </button>
        <p className="export-hint">Exports your beat and sends it to the mixer</p>
      </div>
    </div>
  );
}

export default BeatStudio;
