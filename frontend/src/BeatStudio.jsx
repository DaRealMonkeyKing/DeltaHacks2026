import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';

// Drum sample URLs
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
  const [drumSteps, setDrumSteps] = useState(INITIAL_STEPS);
  const [melodySteps, setMelodySteps] = useState(INITIAL_STEPS);
  
  const [drumPattern, setDrumPattern] = useState(() => {
    const pattern = {};
    INSTRUMENTS.forEach(inst => {
      pattern[inst] = Array(INITIAL_STEPS).fill(false);
    });
    return pattern;
  });
  
  const [melodyPattern, setMelodyPattern] = useState(() => 
    Array(INITIAL_STEPS).fill(null).map(() => [])
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
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragAction, setDragAction] = useState(null); 
  const isDraggingRef = useRef(false);
  const dragActionRef = useRef(null);
  const lastDragCellRef = useRef(null);
  
  const drumPlayersRef = useRef(null);
  const synthRef = useRef(null);
  const sequenceRef = useRef(null);
  const drumVolumesRef = useRef({});
  const synthVolumeRef = useRef(null);
  const drumGridWrappersRef = useRef(new Array(INSTRUMENTS.length).fill(null));
  const isScrollingRef = useRef(false);

  const initAudio = useCallback(async () => {
    if (audioReady) return;
    await Tone.start();
    
    const players = {};
    INSTRUMENTS.forEach(inst => {
      const vol = new Tone.Volume(volumes[inst]).toDestination();
      drumVolumesRef.current[inst] = vol;
      players[inst] = new Tone.Player(DRUM_SAMPLES[inst]).connect(vol);
    });
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

  // Sync scroll for all drum rows
  useEffect(() => {
    const drumWrappers = drumGridWrappersRef.current.filter(Boolean);
    if (drumWrappers.length === 0) return;

    const handleScroll = (sourceElement) => {
      if (isScrollingRef.current) return;
      isScrollingRef.current = true;
      const scrollLeft = sourceElement.scrollLeft;
      drumWrappers.forEach(wrapper => {
        if (wrapper !== sourceElement) wrapper.scrollLeft = scrollLeft;
      });
      requestAnimationFrame(() => { isScrollingRef.current = false; });
    };

    drumWrappers.forEach(wrapper => {
      wrapper.addEventListener('scroll', () => handleScroll(wrapper));
    });
  }, [drumSteps]);

  // Sequence setup
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
              drumPlayersRef.current[inst].start(time);
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
    isPlaying ? Tone.Transport.stop() : Tone.Transport.start();
    setIsPlaying(!isPlaying);
    if (isPlaying) setCurrentStep(-1);
  };

  const stopPlayback = () => {
    Tone.Transport.stop();
    setIsPlaying(false);
    setCurrentStep(-1);
  };

  // Drum logic
  const setDrumStep = (instrument, step, value) => {
    setDrumPattern(prev => ({
      ...prev,
      [instrument]: prev[instrument].map((v, i) => i === step ? value : v)
    }));
  };

  const handleDrumMouseDown = (instrument, step, e) => {
    e.preventDefault();
    const action = drumPattern[instrument][step] ? 'remove' : 'add';
    const setValue = action === 'add';
    setIsDragging(true);
    isDraggingRef.current = true;
    setDrumStep(instrument, step, setValue);

    const handlePointerMove = (moveEvent) => {
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!element) return;
      const instAttr = element.getAttribute('data-instrument');
      const stepAttr = element.getAttribute('data-step');
      if (instAttr && stepAttr) setDrumStep(instAttr, parseInt(stepAttr), setValue);
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      setIsDragging(false);
      isDraggingRef.current = false;
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  // Melody logic
  const setMelodyNote = (noteIndex, step, shouldAdd) => {
    const note = SYNTH_NOTES[noteIndex];
    setMelodyPattern(prev => 
      prev.map((notes, i) => {
        if (i !== step) return notes;
        const noteArray = [...notes];
        const idx = noteArray.indexOf(note);
        if (shouldAdd && idx === -1) noteArray.push(note);
        else if (!shouldAdd && idx > -1) noteArray.splice(idx, 1);
        return noteArray;
      })
    );
  };

  const handleMelodyMouseDown = (noteIndex, step, e) => {
    e.preventDefault();
    const note = SYNTH_NOTES[noteIndex];
    const shouldAdd = !melodyPattern[step].includes(note);
    setIsDragging(true);
    isDraggingRef.current = true;
    setMelodyNote(noteIndex, step, shouldAdd);

    const handlePointerMove = (moveEvent) => {
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const nIdx = element?.getAttribute('data-note-index');
      const sIdx = element?.getAttribute('data-step');
      if (nIdx !== null && sIdx !== null) setMelodyNote(parseInt(nIdx), parseInt(sIdx), shouldAdd);
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      setIsDragging(false);
      isDraggingRef.current = false;
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  // Column Management
  const addDrumColumn = () => {
    if (drumSteps >= MAX_STEPS) return;
    setDrumSteps(s => s + 1);
    setDrumPattern(prev => {
      const newP = {};
      INSTRUMENTS.forEach(inst => newP[inst] = [...prev[inst], false]);
      return newP;
    });
  };

  const removeDrumColumn = () => {
    if (drumSteps <= MIN_STEPS) return;
    setDrumSteps(s => s - 1);
    setDrumPattern(prev => {
      const newP = {};
      INSTRUMENTS.forEach(inst => newP[inst] = prev[inst].slice(0, -1));
      return newP;
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