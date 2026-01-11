import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Tone from 'tone';

// RAF batching system for Spotify-level performance
let rafId = null;
let rafCallbacks = [];
const scheduleRAF = (callback) => {
  rafCallbacks.push(callback);
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      const callbacks = rafCallbacks.slice();
      rafCallbacks = [];
      rafId = null;
      callbacks.forEach(cb => cb());
    });
  }
};

// Throttle utility
const throttle = (fn, delay) => {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
};

// Debounce utility
const debounce = (fn, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

// Object pool for reusing objects
class ObjectPool {
  constructor(createFn, resetFn, size = 100) {
    this.pool = [];
    this.createFn = createFn;
    this.resetFn = resetFn;
    for (let i = 0; i < size; i++) {
      this.pool.push(createFn());
    }
  }
  acquire() {
    return this.pool.length > 0 ? this.pool.pop() : this.createFn();
  }
  release(obj) {
    this.resetFn(obj);
    if (this.pool.length < 200) this.pool.push(obj);
  }
}

// Memoized drum cell component
const DrumCell = React.memo(({ inst, step, active, isPlaying, onMouseDown }) => (
  <button
    className={`step-btn ${active ? 'active' : ''} ${step % 4 === 0 ? 'beat-start' : ''}`}
    data-instrument={inst}
    data-step={step}
    onMouseDown={onMouseDown}
    style={{ userSelect: 'none', touchAction: 'none', willChange: 'transform' }}
  />
), (prev, next) => (
  prev.active === next.active &&
  prev.isPlaying === next.isPlaying &&
  prev.step === next.step
));

// Memoized melody cell component
const MelodyCell = React.memo(({ noteIndex, step, isActive, isMerge, onMouseDown }) => (
  <button
    className={`step-btn melody-btn ${isActive ? 'active' : ''} ${isMerge ? 'merge-note' : ''} ${step % 4 === 0 ? 'beat-start' : ''}`}
    data-note-index={noteIndex}
    data-step={step}
    onMouseDown={onMouseDown}
    style={{ userSelect: 'none', touchAction: 'none', willChange: 'transform' }}
  />
), (prev, next) => (
  prev.isActive === next.isActive &&
  prev.isMerge === next.isMerge &&
  prev.step === next.step
));

const DRUM_SAMPLES = {
  kick: 'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
  snare: 'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
  hihat: 'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
  clap: '/Sound/clap.wav',
  snap: '/Sound/snap.wav',
  '808': '/Sound/808.wav',
  tick: '/Sound/tick.wav',
  cymbal: '/Sound/cymbal.wav',
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
  const [mergePattern, setMergePattern] = useState(() => Array(INITIAL_STEPS).fill(null).map(() => [])); // Track which notes are merge notes
  const [isMergeMode, setIsMergeMode] = useState(false); // Toggle between normal and merge mode
  const [bpm, setBpm] = useState(120);
  const [volumes, setVolumes] = useState({ kick: 0, snare: 0, hihat: -6, clap: -3, snap: -3, '808': -3, tick: -8, cymbal: -4, synth: -3 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const lastDragCellRef = useRef(null);
  const currentStepRef = useRef(-1);
  const currentStepCellsRef = useRef([]);
  const needsSequenceUpdateRef = useRef(true);
   const isMergeModeRef = useRef(isMergeMode);

  const drumPlayersRef = useRef(null);
  const synthRef = useRef(null);
  const sequenceRef = useRef(null);
  const drumVolumesRef = useRef({});
  const synthVolumeRef = useRef(null);
  const drumGridWrapperRef = useRef(null);
  const melodyGridWrapperRef = useRef(null);
  const cachedDrumPatternRef = useRef(drumPattern);
  const cachedMelodyPatternRef = useRef(melodyPattern);
  const cachedMergePatternRef = useRef(mergePattern);
  const cachedMergeDurationsRef = useRef({});
  const batchedUpdatesRef = useRef([]);
  const batchTimeoutRef = useRef(null);

  // Batch multiple state updates into single render
  const batchStateUpdate = useCallback((updateFn) => {
    batchedUpdatesRef.current.push(updateFn);
    if (!batchTimeoutRef.current) {
      batchTimeoutRef.current = setTimeout(() => {
        const updates = batchedUpdatesRef.current.slice();
        batchedUpdatesRef.current = [];
        batchTimeoutRef.current = null;
        React.startTransition(() => {
          updates.forEach(fn => fn());
        });
      }, 0);
    }
  }, []);

  // Update cached refs when patterns change
  useEffect(() => {
    cachedDrumPatternRef.current = drumPattern;
    cachedMelodyPatternRef.current = melodyPattern;
    cachedMergePatternRef.current = mergePattern;
    needsSequenceUpdateRef.current = true;
  }, [drumPattern, melodyPattern, mergePattern]);

   // Update merge mode ref
   useEffect(() => {
     isMergeModeRef.current = isMergeMode;
   }, [isMergeMode]);
  // Pre-calculate merge note durations once
  const mergeNoteDurations = useMemo(() => {
    const durations = {};
    for (let step = 0; step < melodySteps; step++) {
      const mergeNotes = mergePattern[step];
      if (mergeNotes && mergeNotes.length > 0) {
        mergeNotes.forEach(note => {
          const isPreviousStepMerge = step > 0 && mergePattern[step - 1] && mergePattern[step - 1].includes(note);
          if (!isPreviousStepMerge) {
            let duration = 1;
            for (let i = step + 1; i < melodySteps; i++) {
              if (mergePattern[i] && mergePattern[i].includes(note)) {
                duration++;
              } else {
                break;
              }
            }
            durations[`${step}-${note}`] = duration;
          }
        });
      }
    }
    cachedMergeDurationsRef.current = durations;
    return durations;
  }, [mergePattern, melodySteps]);

  const secondsPerSixteenth = useMemo(() => (60 / bpm) / 4, [bpm]);

  // IndexedDB pattern caching
  const savePatternToCache = useMemo(() => debounce((pattern) => {
    try {
      localStorage.setItem('beatstudio_autosave', JSON.stringify({
        drumPattern,
        melodyPattern,
        mergePattern,
        bpm,
        timestamp: Date.now()
      }));
    } catch (e) {
      // Ignore cache errors
    }
  }, 2000), [drumPattern, melodyPattern, mergePattern, bpm]);

  useEffect(() => {
    savePatternToCache();
  }, [drumPattern, melodyPattern, mergePattern, savePatternToCache]);

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
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.2 }
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

  // Update visual indicator via DOM with RAF batching
  const updateCurrentStepVisual = useCallback((step) => {
    scheduleRAF(() => {
      const oldCells = currentStepCellsRef.current;
      const len = oldCells.length;
      for (let i = 0; i < len; i++) {
        oldCells[i]?.classList.remove('current');
      }
      if (step >= 0) {
        const newCells = document.querySelectorAll(`[data-step="${step}"]`);
        currentStepCellsRef.current = Array.from(newCells);
        const newLen = newCells.length;
        for (let i = 0; i < newLen; i++) {
          newCells[i]?.classList.add('current');
        }
      } else {
        currentStepCellsRef.current = [];
      }
      currentStepRef.current = step;
    });
  }, []);

  // Create sequence only when timing/length changes; live-read refs for patterns/durations
  useEffect(() => {
    if (!audioReady) return;
    if (sequenceRef.current) {
      sequenceRef.current.dispose();
      sequenceRef.current = null;
    }
    
    const maxSteps = Math.max(drumSteps, melodySteps);
    const spSixteenth = secondsPerSixteenth;
    
    sequenceRef.current = new Tone.Sequence(
      (time, step) => {
        // Update visual via direct DOM manipulation - zero React overhead
        Tone.Draw.schedule(() => updateCurrentStepVisual(step), time);
        
        // Drums - use cached ref
        const drumPat = cachedDrumPatternRef.current;
        const drumPlayers = drumPlayersRef.current;
        if (step < drumSteps && drumPlayers) {
          for (let i = 0; i < 8; i++) {
            const inst = INSTRUMENTS[i];
            if (drumPat[inst][step]) {
              // tiny epsilon to avoid duplicate-time assertions
              drumPlayers[inst].start(time + 0.0001);
            }
          }
        }
        
        // Melody - use cached refs
        const melodyPat = cachedMelodyPatternRef.current;
        const mergePat = cachedMergePatternRef.current;
        const synth = synthRef.current;
        if (step < melodySteps && synth) {
          const notes = melodyPat[step];
          const mergeNotes = mergePat[step];
          const noteCount = notes.length;
          if (noteCount > 0) {
            for (let i = 0; i < noteCount; i++) {
              const note = notes[i];
              const isMerge = mergeNotes && mergeNotes.includes(note);
              const evtTime = time + i * 0.00001; // spread same-step events slightly
              
              if (isMerge) {
                // read latest precomputed durations dynamically
                const duration = cachedMergeDurationsRef.current[`${step}-${note}`];
                if (duration) {
                  synth.triggerAttackRelease([note], spSixteenth * duration, evtTime);
                }
              } else {
                synth.triggerAttackRelease([note], '16n', evtTime);
              }
            }
          }
        }
      },
      [...Array(maxSteps).keys()],
      '16n'
    );
    
    if (isPlaying) sequenceRef.current.start(0);
    
    return () => {
      if (sequenceRef.current) {
        sequenceRef.current.dispose();
        sequenceRef.current = null;
      }
    };
  }, [audioReady, drumSteps, melodySteps, isPlaying, secondsPerSixteenth, updateCurrentStepVisual]);

  const togglePlay = async () => {
    await initAudio();
    if (isPlaying) {
      Tone.Transport.stop();
      updateCurrentStepVisual(-1);
    } else {
      Tone.Transport.start();
    }
    setIsPlaying(!isPlaying);
  };

  const stopPlayback = () => {
    Tone.Transport.stop();
    setIsPlaying(false);
    updateCurrentStepVisual(-1);
  };

  const setDrumStep = useCallback((instrument, step, value) => {
    batchStateUpdate(() => {
      setDrumPattern(prev => {
        if (prev[instrument][step] === value) return prev; // No-op if same
        const newInstrumentPattern = prev[instrument].slice();
        newInstrumentPattern[step] = value;
        return { ...prev, [instrument]: newInstrumentPattern };
      });
    });
  }, [batchStateUpdate]);

  const handleDrumMouseDown = useCallback((instrument, step, e) => {
    e.preventDefault();
    const setValue = !cachedDrumPatternRef.current[instrument][step];
    setIsDragging(true);
    isDraggingRef.current = true;
    lastDragCellRef.current = `${instrument}-${step}`;
    setDrumStep(instrument, step, setValue);

    const handlePointerMove = throttle((moveEvent) => {
      if (!isDraggingRef.current) return;
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!element) return;
      const instAttr = element.getAttribute('data-instrument');
      const stepAttr = element.getAttribute('data-step');
      if (instAttr && stepAttr) {
        const key = `${instAttr}-${stepAttr}`;
        if (lastDragCellRef.current === key) return;
        lastDragCellRef.current = key;
        scheduleRAF(() => setDrumStep(instAttr, parseInt(stepAttr, 10), setValue));
      }
    }, 16); // ~60fps throttle

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      setIsDragging(false);
      isDraggingRef.current = false;
      lastDragCellRef.current = null;
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerup', handlePointerUp, { once: true, passive: true });
  }, [setDrumStep]);

  const setMelodyNote = useCallback((noteIndex, step, shouldAdd) => {
    const note = SYNTH_NOTES[noteIndex];
     const currentMergeMode = isMergeModeRef.current;
    
    batchStateUpdate(() => {
       // Always update melody pattern
      setMelodyPattern(prev => {
        const noteArray = prev[step].slice();
        const idx = noteArray.indexOf(note);
        
         if ((shouldAdd && idx !== -1) || (!shouldAdd && idx === -1)) return prev;
        
        if (shouldAdd) {
          noteArray.push(note);
        } else {
          noteArray.splice(idx, 1);
        }
        
        const newPattern = prev.slice();
        newPattern[step] = noteArray;
        return newPattern;
      });
      
       // Update merge pattern based on current merge mode
       setMergePattern(prev => {
         const noteArray = prev[step].slice();
         const idx = noteArray.indexOf(note);
       
         // If merge mode is ON, add/remove from merge pattern like melody
         // If merge mode is OFF, only remove if removing from melody
         if (currentMergeMode) {
           // Merge mode ON: sync with melody pattern
           if ((shouldAdd && idx !== -1) || (!shouldAdd && idx === -1)) return prev;
         
           if (shouldAdd) {
             noteArray.push(note);
           } else {
             noteArray.splice(idx, 1);
           }
         } else {
           // Merge mode OFF: only remove from merge if removing from melody
           if (!shouldAdd && idx !== -1) {
             noteArray.splice(idx, 1);
           } else {
             return prev; // No change needed
           }
         }
       
         const newPattern = prev.slice();
         newPattern[step] = noteArray;
         return newPattern;
       });
    });
   }, [batchStateUpdate]);

  const handleMelodyMouseDown = useCallback((noteIndex, step, e) => {
    e.preventDefault();
    const note = SYNTH_NOTES[noteIndex];
    const shouldAdd = !cachedMelodyPatternRef.current[step].includes(note);
    setIsDragging(true);
    isDraggingRef.current = true;
    lastDragCellRef.current = `${noteIndex}-${step}`;
    setMelodyNote(noteIndex, step, shouldAdd);

    const handlePointerMove = throttle((moveEvent) => {
      if (!isDraggingRef.current) return;
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const nIdx = element?.getAttribute('data-note-index');
      const sIdx = element?.getAttribute('data-step');
      if (nIdx !== null && sIdx !== null) {
        const key = `${nIdx}-${sIdx}`;
        if (lastDragCellRef.current === key) return;
        lastDragCellRef.current = key;
        scheduleRAF(() => setMelodyNote(parseInt(nIdx, 10), parseInt(sIdx, 10), shouldAdd));
      }
    }, 16);

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      setIsDragging(false);
      isDraggingRef.current = false;
      lastDragCellRef.current = null;
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerup', handlePointerUp, { once: true, passive: true });
  }, [setMelodyNote]);

  const addDrumColumn = useCallback(() => {
    if (drumSteps >= MAX_STEPS) return;
    scheduleRAF(() => {
      setDrumSteps(s => s + 1);
      setDrumPattern(prev => {
        const next = {};
        for (let i = 0; i < 8; i++) {
          const inst = INSTRUMENTS[i];
          next[inst] = [...prev[inst], false];
        }
        return next;
      });
    });
  }, [drumSteps]);

  const removeDrumColumn = useCallback(() => {
    if (drumSteps <= MIN_STEPS) return;
    scheduleRAF(() => {
      setDrumSteps(s => s - 1);
      setDrumPattern(prev => {
        const next = {};
        for (let i = 0; i < 8; i++) {
          const inst = INSTRUMENTS[i];
          next[inst] = prev[inst].slice(0, -1);
        }
        return next;
      });
    });
  }, [drumSteps]);

  const addMelodyColumn = useCallback(() => {
    if (melodySteps >= MAX_STEPS) return;
    scheduleRAF(() => {
      setMelodySteps(s => s + 1);
      setMelodyPattern(prev => [...prev, []]);
      setMergePattern(prev => [...prev, []]);
    });
  }, [melodySteps]);

  const removeMelodyColumn = useCallback(() => {
    if (melodySteps <= MIN_STEPS) return;
    scheduleRAF(() => {
      setMelodySteps(s => s - 1);
      setMelodyPattern(prev => prev.slice(0, -1));
      setMergePattern(prev => prev.slice(0, -1));
    });
  }, [melodySteps]);

  const clearAll = () => {
    const emptyDrums = {};
    INSTRUMENTS.forEach(inst => { emptyDrums[inst] = Array(drumSteps).fill(false); });
    setDrumPattern(emptyDrums);
    setMelodyPattern(Array(melodySteps).fill(null).map(() => []));
    setMergePattern(Array(melodySteps).fill(null).map(() => []));
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
        const offlineSynthVol = new Tone.Volume(volumes.synth).toDestination();
        await Promise.all(INSTRUMENTS.map(inst => offlinePlayers[inst].load(DRUM_SAMPLES[inst])));
        const offlineSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.2 }
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
            const mergeNotes = mergePattern[step];
            if (notes && notes.length > 0) {
              notes.forEach(note => {
                const isMerge = mergeNotes && mergeNotes.includes(note);
                
                if (isMerge) {
                  // Only trigger merge notes at the START of their sequence
                  const isPreviousStepMerge = step > 0 && mergePattern[step - 1] && mergePattern[step - 1].includes(note);
                  if (!isPreviousStepMerge) {
                    // Calculate duration in steps
                    let duration = 1;
                    for (let i = step + 1; i < melodySteps; i++) {
                      if (mergePattern[i] && mergePattern[i].includes(note)) {
                        duration++;
                      } else {
                        break;
                      }
                    }
                    // Convert to seconds
                    const secondsPerSixteenth = (60 / bpm) / 4;
                    const totalSeconds = secondsPerSixteenth * duration;
                    transport.schedule(t => offlineSynth.triggerAttackRelease([note], totalSeconds, t), time);
                  }
                } else {
                  // Normal note
                  const sixteenthNoteDuration = (60 / bpm) / 4;
                  transport.schedule(t => offlineSynth.triggerAttackRelease([note], sixteenthNoteDuration, t), time);
                }
              });
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
                    <DrumCell
                      key={step}
                      inst={inst}
                      step={step}
                      active={active}
                      isPlaying={isPlaying}
                      onMouseDown={(e) => handleDrumMouseDown(inst, step, e)}
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
          <button 
            onClick={() => setIsMergeMode(!isMergeMode)} 
            className={`btn btn-sm ${isMergeMode ? 'btn-primary' : 'btn-secondary'}`}
            style={{ marginLeft: '10px' }}
          >
            {isMergeMode ? '🔵 Merge Mode' : '⚪ Normal Mode'}
          </button>
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
                    {melodyPattern.map((activeNotes, step) => {
                      const isActive = activeNotes.includes(note);
                      const isMerge = isActive && mergePattern[step] && mergePattern[step].includes(note);
                      return (
                        <MelodyCell
                          key={step}
                          noteIndex={SYNTH_NOTES.length - 1 - noteIdx}
                          step={step}
                          isActive={isActive}
                          isMerge={isMerge}
                          onMouseDown={(e) => handleMelodyMouseDown(SYNTH_NOTES.length - 1 - noteIdx, step, e)}
                        />
                      );
                    })}
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
