import { useEffect, useRef, useState } from 'react';
import { stepDown, track, type MealLog } from '@/lib/spike';

export function spokenSummary(log: MealLog): string {
  const name = log.estimate.name.trim().split(/\s+/).slice(0, 6).join(' ');
  const original = log.estimate.glycemic_level;
  const fix = log.appliedFixes[0];
  const action = fix === 'walk' ? ((log.movementType ?? 'walk') === 'walk' ? 'a 10-minute walk after' : '10 minutes of movement after')
    : fix === 'food_order' ? 'veggies or protein first' : 'the meal swap';
  return `${name}: ${original.toLowerCase()} estimated spike. ${
    fix ? `With ${action}: ${stepDown(original).toLowerCase()} illustrated spike. ` : ''
  }Not a measurement.`;
}

export function HearSummary({ log }: { log: MealLog }) {
  const summary = spokenSummary(log);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [note, setNote] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const blobUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const speaking = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    sequence.current++;
    controller.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    if (audio.current) {
      audio.current.onplaying = null;
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
      audio.current.removeAttribute('src');
      audio.current = null;
    }
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = null;
    if (speaking.current && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    speaking.current = false;
  };

  useEffect(() => {
    stop();
    setState('idle');
    setNote('');
    return stop;
    // A changed estimate or fix must never play an old cached summary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, log.id]);

  const play = async () => {
    stop();
    setNote('');
    setState('loading');
    const current = sequence.current;
    let started = false;
    let fallbackStarted = false;
    const record = (source: 'elevenlabs' | 'browser') => {
      if (!log.demo) track({ event: 'voice_played', source });
    };
    const fallback = () => {
      if (current !== sequence.current || fallbackStarted || started) return;
      fallbackStarted = true;
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      audio.current?.pause();
      if (audio.current) audio.current.onplaying = null;
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        setState('idle');
        setNote('Audio is unavailable in this browser. Read the summary below.');
        return;
      }
      setNote('Using browser voice. This is an illustrative AI estimate.');
      const utterance = new SpeechSynthesisUtterance(summary);
      utterance.lang = 'en-US';
      utterance.onstart = () => {
        if (current !== sequence.current) return;
        setState('playing');
        record('browser');
      };
      utterance.onend = () => {
        if (current === sequence.current) { speaking.current = false; setState('idle'); }
      };
      utterance.onerror = () => {
        if (current === sequence.current) {
          speaking.current = false;
          setState('idle');
          setNote('Browser audio could not play. Read the summary below or tap Hear it to retry.');
        }
      };
      speaking.current = true;
      window.speechSynthesis.speak(utterance);
    };
    timer.current = setTimeout(fallback, 5000);
    controller.current = new AbortController();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/spike/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: summary }),
        signal: controller.current.signal,
      });
      if (!response.ok) throw new Error('Voice unavailable');
      const blob = await response.blob();
      if (current !== sequence.current || fallbackStarted) return;
      if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Invalid audio');
      const url = URL.createObjectURL(blob);
      blobUrl.current = url;
      const player = new Audio(url);
      audio.current = player;
      player.onplaying = () => {
        if (current !== sequence.current || fallbackStarted) { player.pause(); return; }
        started = true;
        if (timer.current) clearTimeout(timer.current);
        setState('playing');
        record('elevenlabs');
      };
      player.onended = () => {
        if (current === sequence.current) setState('idle');
        URL.revokeObjectURL(url);
      };
      player.onerror = () => {
        if (started && current === sequence.current) {
          started = false;
          setNote('Voice playback stopped. Switching to browser voice.');
        }
        fallback();
      };
      await player.play();
    } catch {
      fallback();
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        data-testid="button-hear-summary"
        className="rounded-full border border-input bg-card px-4 py-2 text-sm font-medium hover:border-foreground/40 transition-colors"
        onClick={() => state === 'idle' ? void play() : (stop(), setState('idle'))}
        aria-label={state === 'idle' ? 'Hear it' : 'Stop voice summary'}
      >{state === 'loading' ? 'Preparing voice… Cancel' : state === 'playing' ? 'Stop audio' : 'Hear it'}</button>
      <p className="text-xs text-muted-foreground mt-2">AI voice summary · tap to listen</p>
      <p className="text-xs text-muted-foreground mt-1" data-testid="text-voice-summary">{summary}</p>
      {note && <p role="status" className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}
