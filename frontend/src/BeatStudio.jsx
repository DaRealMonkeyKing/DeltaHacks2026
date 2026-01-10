import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';

const DRUM_SAMPLES = {
  kick: 'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
  snare: 'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
  hihat: 'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
};

const SYNTH_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const MIN_STEPS = 4;
const MAX_STEPS = 32;
const INITIAL_STEPS = 16;
const INSTRUMENTS = ['kick', 'snare', 'hihat'];

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
  const [volumes, setVolumes] = useState({ kick: 0, snare: 0, hihat: -6, synth: -3 });
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
                transport.schedule(t => offlinePlayers[inst].start(t), time);
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
