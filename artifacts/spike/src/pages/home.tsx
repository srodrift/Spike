import { useEffect, useRef, useState } from 'react';
import { useSearch, useLocation } from 'wouter';
import { Camera, Mic, MicOff, Plus, X, ArrowRight, RotateCcw, Footprints, Salad, Shuffle, Check, AlertCircle } from 'lucide-react';
import { useEstimateMeal, estimateMeal, type MealEstimate, type MealInput } from '@workspace/api-client-react';
import { CurveChart } from '@/components/curve-chart';
import { HearSummary } from '@/components/hear-summary';
import { WalkSuggestion } from '@/components/walk-suggestion';
import { MovementRoutine } from '@/components/movement-routine';
import { MovementSettingsForm } from '@/components/movement-settings-form';
import { loadMovementSettings, movementOption, type MovementSettings } from '@/lib/movement';
import {
  compressImage,
  loadLogs,
  upsertLog,
  newId,
  track,
  stepDown,
  LEVEL_STYLE,
  type FixType,
  type InputKind,
  type MealLog,
} from '@/lib/spike';

type MoveKind = 'walk' | 'home' | 'desk' | 'gentle';
const DOCTOR_MSG = 'Check with your doctor about safe movement after meals';
const CLEAR_MOVE = { walkCompleted: false, walkStartedAt: undefined, walkMinutes: undefined, walkViaPark: undefined, movementStartedAt: undefined, movementCompleted: undefined, movementMinutes: undefined };

/** Reopened meals must pass today's saved check before showing any movement plan. */
function displayLog(log: MealLog, settings: MovementSettings | null): MealLog {
  const option = settings ? movementOption(settings) : 'none';
  if (log.appliedFixes.includes('walk') && (option === 'none' || option !== (log.movementType ?? 'walk'))) {
    return { ...log, appliedFixes: log.appliedFixes.filter((f) => f !== 'walk') };
  }
  return log;
}

function HeroCurves() {
  return (
    <figure className="mt-4 flex items-end gap-4 max-w-sm" data-testid="img-hero-curves">
      <svg viewBox="0 0 160 70" className="w-40 h-[70px] shrink-0" aria-hidden="true" focusable="false">
        <path d="M4 64 H156" stroke="hsl(var(--border))" strokeWidth="1.5" />
        <path d="M6 62 C30 62 40 8 62 8 C84 8 92 62 120 62 L154 62" fill="none" stroke="hsl(12 82% 56%)" strokeWidth="3" strokeLinecap="round" />
        <path d="M6 62 C34 62 48 36 72 36 C98 36 110 60 154 60" fill="none" stroke="hsl(170 40% 36%)" strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" />
      </svg>
      <figcaption className="text-xs space-y-1.5 pb-1">
        <span className="flex items-center gap-2"><span className="w-4 h-[3px] rounded bg-primary" />Your meal</span>
        <span className="flex items-center gap-2"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: 'hsl(170 40% 36%)' }} />With 10 min of movement</span>
      </figcaption>
    </figure>
  );
}

type Stage = 'entry' | 'loading' | 'review' | 'reanalyzing' | 'result';
interface Chip { id: string; name: string; portion: string; calories?: number; orig?: { name: string; portion: string } }

const SAMPLES = [
  'Two slices of pepperoni pizza and a cola',
  'Greek yogurt with berries and a handful of walnuts',
  'Chicken burrito bowl with white rice, beans and salsa',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;
function getSR(): SR | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as SR | null;
}

async function estimateWithTimeout(data: MealInput): Promise<MealEstimate> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    return await estimateMeal(data, { signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export default function Home() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [stage, setStage] = useState<Stage>('entry');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [inputKind, setInputKind] = useState<InputKind>('text');
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [first, setFirst] = useState<MealEstimate | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [log, setLog] = useState<MealLog | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const recRef = useRef<SR>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewedFor = useRef<string | null>(null);
  const [settings, setSettings] = useState<MovementSettings | null>(() => loadMovementSettings());
  const [formOpen, setFormOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState(false);
  const [doctorNote, setDoctorNote] = useState(false);

  const estimate = useEstimateMeal({ mutation: { mutationFn: ({ data }) => estimateWithTimeout(data) } });

  useEffect(() => {
    document.title = 'Spike — Read your plate';
  }, []);

  // Reopen a log
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('movement') === 'settings') {
      setPendingMove(false);
      setFormOpen(true);
    }
    const id = params.get('log');
    if (!id) return;
    try {
      const found = loadLogs().find((l) => l.id === id);
      if (found) {
        setLog(found);
        setStage('result');
        viewedFor.current = found.id; // reopen is not a new result view
      } else setError('That meal is no longer in this device\u2019s history.');
    } catch {
      setError('Could not read your saved meals from this device.');
    }
  }, [search]);

  // fix_viewed once per result
  useEffect(() => {
    if (stage === 'result' && log && viewedFor.current !== log.id) {
      viewedFor.current = log.id;
      (['walk', 'food_order', 'swap'] as FixType[]).forEach((f) => track({ event: 'fix_viewed', fix_type: f }));
    }
  }, [stage, log]);

  const reset = () => {
    setStage('entry');
    setText('');
    setPhoto(null);
    setFirst(null);
    setChips([]);
    setLog(null);
    setError(null);
    setSaveError(null);
    setFormOpen(false);
    setPendingMove(false);
    setDoctorNote(false);
    if (search) navigate('/');
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    setError(null);
    try {
      const data = await compressImage(f);
      setPhoto(data);
      setInputKind('photo');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that photo.');
    }
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getSR();
    if (!Ctor) {
      setVoiceNote('Voice input is not supported in this browser. Typing works just as well.');
      return;
    }
    setVoiceNote(null);
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    const base = text ? text.trim() + ' ' : '';
    rec.onresult = (ev: SR) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setText(base + t);
      setInputKind('voice');
      setPhoto(null);
    };
    rec.onerror = (ev: SR) => {
      const code = ev?.error;
      setVoiceNote(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser settings, or type instead.'
          : code === 'no-speech'
            ? 'We did not catch anything. Try again a little closer to the mic.'
            : 'Voice input stopped unexpectedly. You can type instead.',
      );
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      setVoiceNote('Could not start the microphone. You can type instead.');
    }
  };

  const analyze = () => {
    setError(null);
    const kind: InputKind = photo ? 'photo' : inputKind === 'voice' && text.trim() ? 'voice' : 'text';
    if (!photo && !text.trim()) {
      setError('Add a photo, speak, or type what is on your plate.');
      return;
    }
    setInputKind(kind);
    const data: MealInput = photo ? { input: 'photo', image: photo, ...(text.trim() ? { text: text.trim() } : {}) } : { input: kind, text: text.trim() };
    setStage('loading');
    estimate.mutate(
      { data },
      {
        onSuccess: (r) => {
          setFirst(r);
          setChips(r.foods.map((f) => ({ id: newId(), name: f.name, portion: f.portion, calories: f.calories, orig: { ...f } })));
          setStage('review');
        },
        onError: (e) => {
          setPhoto(null);
          setInputKind(kind === 'voice' ? 'voice' : 'text');
          setError(
            e instanceof Error && e.message === 'timeout'
              ? 'That took longer than 10 seconds. Describe your meal in a few words below and try again.'
              : kind === 'photo'
                ? 'We could not read that photo. Describe the meal below, like "pasta with tomato sauce and a side salad".'
                : 'Something went wrong reading your meal. Your words are saved below, so just try again.',
          );
          setStage('entry');
        },
      },
    );
  };

  const changedCount = () => {
    const removed = first ? first.foods.length - chips.filter((c) => c.orig).length : 0;
    const changed = chips.filter(
      (c) => !c.orig || c.orig.name !== c.name.trim() || c.orig.portion !== c.portion.trim(),
    ).length;
    return removed + changed;
  };

  const persist = (est: MealEstimate) => {
    const entry: MealLog = {
      id: newId(),
      date: new Date().toISOString(),
      input: inputKind,
      estimate: est,
      appliedFixes: [],
      walkCompleted: false,
    };
    setLog(entry);
    setStage('result');
    track({ event: 'spike_estimated', level: est.glycemic_level, calories: est.calories });
    try {
      upsertLog(entry);
      setSaveError(null);
      track({ event: 'meal_logged', input: entry.input });
    } catch {
      setSaveError('This meal could not be saved to your device (storage may be full or blocked). Your estimate is shown but will not appear in Week.');
    }
  };

  const confirm = () => {
    if (!first) return;
    const clean = chips.filter((c) => c.name.trim());
    if (!clean.length) {
      setError('Add at least one food before seeing your estimate.');
      return;
    }
    const count = changedCount();
    if (count === 0) {
      persist(first);
      return;
    }
    track({ event: 'foods_edited', count });
    setError(null);
    setStage('reanalyzing');
    const desc = clean.map((c) => `${c.name.trim()}${c.portion.trim() ? ` (${c.portion.trim()})` : ''}`).join(', ');
    estimate.mutate(
      { data: { input: 'text', text: desc || first.name } },
      {
        onSuccess: (r) => persist(r),
        onError: (e) => {
          setText(desc);
          setPhoto(null);
          setInputKind('text');
          setStage('entry');
          setError(
            e instanceof Error && e.message === 'timeout'
              ? 'Re-reading your corrections took over 10 seconds. Your corrected meal is in the text box; try again.'
              : 'We could not re-read your corrected foods. Your corrected meal is in the text box; try again.',
          );
        },
      },
    );
  };

  const updateLog = (next: MealLog) => {
    try {
      upsertLog(next);
      setLog(next);
      setSaveError(null);
      return true;
    } catch {
      setSaveError('Could not save that change to your device. Nothing was updated.');
      return false;
    }
  };

  const applyFix = (f: FixType, base?: MealLog, s?: MovementSettings | null) => {
    const cur = base ?? log;
    const st = s === undefined ? settings : s;
    if (!cur) return;
    let extra: Partial<MealLog> = {};
    if (f === 'walk') {
      if (!st) {
        setPendingMove(true);
        setFormOpen(true);
        return;
      }
      const opt = movementOption(st);
      if (!cur.demo) track({ event: 'movement_option_shown', type: opt });
      if (opt === 'none') {
        setDoctorNote(true);
        return;
      }
      setDoctorNote(false);
      extra = { ...CLEAR_MOVE, movementType: opt };
    }
    const shown = displayLog(cur, st);
    if (cur.appliedFixes.includes(f) && shown.appliedFixes.includes(f)) return;
    const wasEmpty = shown.appliedFixes.length === 0;
    if (!updateLog({ ...cur, ...extra, appliedFixes: [...cur.appliedFixes.filter((x) => x !== f), f] })) return;
    if (!cur.demo) track({ event: 'fix_applied', fix_type: f });
    const from = cur.estimate.glycemic_level;
    if (!cur.demo && wasEmpty && from !== 'Low') track({ event: 'spike_reduced', from, to: stepDown(from) });
  };

  const removeFix = (f: FixType) => {
    if (!log) return;
    updateLog({
      ...log,
      appliedFixes: log.appliedFixes.filter((x) => x !== f),
      ...(f === 'walk' ? { ...CLEAR_MOVE, movementType: undefined } : {}),
    });
  };

  const onSettingsSaved = (s: MovementSettings) => {
    const firstTime = !settings;
    setSettings(s);
    setFormOpen(false);
    if (firstTime) track({ event: 'safety_check_completed' });
    if (search.includes('movement=settings')) navigate(log ? `/?log=${log.id}` : '/');
    if (!log || stage !== 'result') { setPendingMove(false); return; }
    const opt = movementOption(s);
    if (pendingMove) {
      setPendingMove(false);
      applyFix('walk', log, s);
      return;
    }
    if (!log.appliedFixes.includes('walk')) { setDoctorNote(false); return; }
    const curType = log.movementType ?? 'walk';
    if (opt === 'none') {
      if (!log.demo) track({ event: 'movement_option_shown', type: 'none' });
      setDoctorNote(true);
      updateLog({ ...log, ...CLEAR_MOVE, movementType: undefined, appliedFixes: log.appliedFixes.filter((x) => x !== 'walk') });
    } else if (opt !== curType) {
      if (!log.demo) track({ event: 'movement_option_shown', type: opt });
      setDoctorNote(false);
      updateLog({ ...log, ...CLEAR_MOVE, movementType: opt });
    }
  };

  const settingsForm = formOpen && (
    <MovementSettingsForm
      initial={settings}
      onSaved={onSettingsSaved}
      onCancel={() => {
        setFormOpen(false);
        setPendingMove(false);
        if (search.includes('movement=settings')) navigate(log ? `/?log=${log.id}` : '/');
      }}
    />
  );

  return (
    <div>
      {stage === 'entry' && (
        <section className="rise">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Before the first bite</p>
          <h1 className="font-display text-[2.6rem] leading-[1.02] mt-2">
            What&rsquo;s on your <em className="text-primary">plate</em>?
          </h1>
          <p className="text-muted-foreground mt-3 max-w-sm">
            Snap, say, or type your meal. See how it may spike your blood sugar, and one easy way to flatten it.
          </p>
          <HeroCurves />
          {stage === 'entry' && settingsForm}

          <div className="mt-7 grid grid-cols-2 gap-3">
            <button
              data-testid="button-photo"
              onClick={() => fileRef.current?.click()}
              className="group rounded-2xl bg-foreground text-background p-4 text-left active:scale-[0.97] transition-transform"
            >
              <Camera className="w-6 h-6 text-accent transition-transform group-hover:-rotate-6" />
              <div className="mt-6 font-semibold">Photo</div>
              <div className="text-xs opacity-70">Camera or upload</div>
            </button>
            <button
              data-testid="button-mic"
              onClick={toggleMic}
              className={`relative overflow-hidden rounded-2xl p-4 text-left active:scale-[0.97] transition-transform ${
                listening ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {listening && <span className="absolute right-4 top-4 w-6 h-6 rounded-full bg-primary-foreground breathe" />}
              {listening ? <MicOff className="w-6 h-6 relative" /> : <Mic className="w-6 h-6" />}
              <div className="mt-6 font-semibold">{listening ? 'Listening\u2026' : 'Speak'}</div>
              <div className="text-xs opacity-70">{listening ? 'Tap to stop' : 'Describe out loud'}</div>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="input-photo"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {voiceNote && (
            <p className="mt-3 text-sm text-muted-foreground flex gap-2" data-testid="text-voice-note">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {voiceNote}
            </p>
          )}

          {photo && (
            <div className="mt-4 relative rounded-2xl overflow-hidden border border-border rise">
              <img src={photo} alt="Your meal" className="w-full max-h-64 object-cover" data-testid="img-preview" />
              <button
                onClick={() => {
                  setPhoto(null);
                  setInputKind('text');
                }}
                data-testid="button-remove-photo"
                className="absolute top-2 right-2 rounded-full bg-background/90 p-1.5"
                aria-label="Remove photo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <label className="block mt-5">
            <span className="text-sm font-medium">{photo ? 'Anything to add? (optional)' : 'Or type it'}</span>
            <textarea
              data-testid="input-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (inputKind === 'voice' && !e.target.value) setInputKind('text');
              }}
              rows={3}
              maxLength={2000}
              placeholder="e.g. a bowl of ramen with a soft egg"
              className="mt-2 w-full rounded-2xl border border-input bg-card px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring/40 resize-none"
            />
          </label>
          {!text && !photo && (
            <div className="flex flex-wrap gap-2 mt-2">
              {SAMPLES.map((s, i) => (
                <button
                  key={s}
                  data-testid={`button-sample-${i}`}
                  onClick={() => {
                    setText(s);
                    setInputKind('text');
                  }}
                  className="text-xs rounded-full border border-dashed border-input px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl bg-destructive/10 text-destructive p-3 text-sm flex gap-2" data-testid="text-error">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <button
            data-testid="button-analyze"
            onClick={analyze}
            className="mt-5 w-full rounded-full bg-primary text-primary-foreground py-4 font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-[0_8px_24px_-10px_hsl(12_82%_56%)]"
          >
            Read my plate <ArrowRight className="w-4 h-4" />
          </button>
          <p className="mt-3 text-[11px] text-center text-muted-foreground">
            Your photo or words go to an AI for analysis. Logs stay on this device.
          </p>
        </section>
      )}

      {(stage === 'loading' || stage === 'reanalyzing') && (
        <section className="py-20 flex flex-col items-center text-center rise" data-testid="status-loading">
          <div className="relative w-28 h-28">
            <div className="absolute inset-0 rounded-full border-[10px] border-muted" />
            <div className="absolute inset-0 rounded-full border-[10px] border-transparent border-t-primary plate-spin" />
            <div className="absolute inset-6 rounded-full bg-secondary" />
          </div>
          <p className="font-display text-2xl mt-8">Reading your plate...</p>
          <p className="text-sm text-muted-foreground mt-2">
            {stage === 'reanalyzing' ? 'Taking your corrections into account' : 'Usually a few seconds'}
          </p>
          <div className="mt-8 w-full space-y-2">
            <div className="h-10 rounded-full bg-muted animate-pulse" />
            <div className="h-10 w-3/4 mx-auto rounded-full bg-muted animate-pulse" />
          </div>
        </section>
      )}

      {stage === 'review' && first && (
        <section className="rise">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Step 2 of 3 &middot; check our read</p>
          <h1 className="font-display text-3xl mt-2">{first.name}</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Here&rsquo;s what we spotted. Fix any names or portions before we sketch the curve.
          </p>
          <ul className="mt-5 space-y-2">
            {chips.map((c, i) => (
              <li key={c.id} className="rise flex flex-wrap items-center gap-2 rounded-2xl bg-card border border-card-border p-2 pl-4" style={{ animationDelay: `${i * 50}ms` }}>
                <input
                  data-testid={`input-food-name-${i}`}
                  value={c.name}
                  onChange={(e) => setChips((cs) => cs.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
                  placeholder="Food"
                  className="flex-1 min-w-0 bg-transparent font-medium outline-none"
                />
                <input
                  data-testid={`input-food-portion-${i}`}
                  value={c.portion}
                  onChange={(e) => setChips((cs) => cs.map((x) => (x.id === c.id ? { ...x, portion: e.target.value } : x)))}
                  placeholder="portion"
                  className="w-28 rounded-full bg-muted px-3 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/40"
                />
                <span className="order-last basis-full text-[11px] text-muted-foreground pb-1" data-testid={`text-food-calories-${i}`}>
                  {typeof c.calories === 'number' && c.orig?.name === c.name.trim() && c.orig?.portion === c.portion.trim()
                    ? `~${Math.round(c.calories).toLocaleString()} kcal · Estimate`
                    : 'Estimate · calories recalculated when confirmed'}
                </span>
                <button
                  data-testid={`button-remove-food-${i}`}
                  onClick={() => setChips((cs) => cs.filter((x) => x.id !== c.id))}
                  aria-label={`Remove ${c.name}`}
                  className="p-2 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            data-testid="button-add-food"
            onClick={() => setChips((cs) => [...cs, { id: newId(), name: '', portion: '' }])}
            className="mt-3 w-full rounded-2xl border border-dashed border-input py-3 text-sm text-muted-foreground flex items-center justify-center gap-2 hover:text-foreground hover:border-foreground transition-colors"
          >
            <Plus className="w-4 h-4" /> Add a food
          </button>
          <p className="mt-3 text-xs text-muted-foreground">Portions are guesses from what we could see or hear.</p>
          {error && (
            <div className="mt-4 rounded-2xl bg-destructive/10 text-destructive p-3 text-sm flex gap-2" data-testid="text-error">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <button data-testid="button-start-over" onClick={reset} className="rounded-full border border-input px-5 py-4 text-sm font-medium">
              Start over
            </button>
            <button
              data-testid="button-confirm"
              disabled={chips.filter((c) => c.name.trim()).length === 0}
              onClick={confirm}
              className="flex-1 rounded-full bg-primary text-primary-foreground py-4 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              {changedCount() > 0 ? (error ? 'Retry with my edits' : 'Update and show curve') : 'Looks right, show curve'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {stage === 'result' && log && <Result log={displayLog(log, settings)} saveError={saveError} onFix={(f) => applyFix(f)} onUnfix={removeFix}
          settingsForm={settingsForm || null}
          doctorNote={doctorNote || !!(settings?.doctorLimit && log.appliedFixes.includes('walk'))}
          onOpenSettings={() => { setPendingMove(false); setFormOpen(true); }}
          onMoveStart={(movementStartedAt) => updateLog({ ...log, movementStartedAt, movementCompleted: false })}
          onMoveComplete={(movementMinutes) => updateLog({ ...log, movementCompleted: true, movementMinutes })}
          onMoveUndo={() => updateLog({ ...log, movementCompleted: false, movementStartedAt: undefined, movementMinutes: undefined })} onWalk={(done) => updateLog({ ...log, walkCompleted: done, walkStartedAt: done ? log.walkStartedAt : undefined, walkMinutes: done ? log.walkMinutes : undefined, walkViaPark: done ? log.walkViaPark : undefined })}
          onWalkStart={(walkStartedAt, walkViaPark) => updateLog({ ...log, walkStartedAt, walkViaPark })}
          onWalkComplete={(walkMinutes, walkViaPark) => updateLog({ ...log, walkCompleted: true, walkMinutes, walkViaPark })}
          onNew={reset} />}

    </div>
  );
}

function Result({
  log,
  saveError,
  onFix,
  onUnfix,
  onWalk,
  onWalkStart,
  onWalkComplete,
  onNew,
  settingsForm,
  doctorNote,
  onOpenSettings,
  onMoveStart,
  onMoveComplete,
  onMoveUndo,
}: {
  settingsForm: React.ReactNode;
  doctorNote: boolean;
  onOpenSettings: () => void;
  onMoveStart: (at: number) => boolean;
  onMoveComplete: (minutes: number) => boolean;
  onMoveUndo: () => boolean;
  log: MealLog;
  saveError: string | null;
  onFix: (f: FixType) => void;
  onUnfix: (f: FixType) => void;
  onWalk: (done: boolean) => boolean;
  onWalkStart: (startedAt: number, viaPark: boolean) => boolean;
  onWalkComplete: (minutes: number, viaPark: boolean) => boolean;
  onNew: () => void;
}) {
  const est = log.estimate;
  const level = est.glycemic_level;
  const applied = log.appliedFixes;
  const adjusted = applied.length ? stepDown(level) : null;
  const s = LEVEL_STYLE[level];
  const moveType: MoveKind = log.movementType ?? 'walk';
  const fixes: { type: FixType; label: string; icon: typeof Footprints }[] = [
    { type: 'walk', label: '10 min of movement after', icon: Footprints },
    { type: 'food_order', label: 'Eat veggies/protein first', icon: Salad },
    { type: 'swap', label: est.swaps[0] ?? 'Try a lighter swap', icon: Shuffle },
  ];

  return (
    <section className="rise">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Step 3 of 3 &middot; the curve</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rounded-full px-5 py-2 text-2xl font-bold tracking-tight text-[hsl(40_60%_98%)]" style={{ background: s.color }} data-testid="status-level">
          {level === 'Medium' ? 'Moderate' : level} spike
        </span>
        {typeof est.calories === 'number' && Number.isFinite(est.calories) && (
          <span className="text-sm text-muted-foreground" data-testid="text-meal-calories">
            ~{Math.round(est.calories).toLocaleString()} kcal <span className="text-[10px]">· Estimate</span>
          </span>
        )}
      </div>
      <h1 className="font-display text-3xl mt-3" data-testid="text-meal-name">{est.name}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-mono">{new Date(log.date).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed" data-testid="text-reason">{est.reason}</p>

      {saveError && (
        <div className="mt-4 rounded-2xl bg-destructive/10 text-destructive p-3 text-sm flex gap-2" data-testid="text-save-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {saveError}
        </div>
      )}

      <div className="mt-5 rounded-3xl bg-card border border-card-border p-4">
        <CurveChart original={level} adjusted={adjusted} fixCount={applied.length} delayed={applied.includes('food_order')} />
        <p className="mt-3 text-xs font-medium text-muted-foreground" data-testid="text-illustrative">Illustrative estimate, not a measurement.</p>
      </div>

      {adjusted && (
        <div className="mt-4 rounded-2xl p-4 rise" style={{ background: LEVEL_STYLE[adjusted].soft }} data-testid="text-reduced">
          {level !== 'Low' ? (
            <p className="font-semibold">Spike reduced: {level} &rarr; {adjusted}.</p>
          ) : (
            <p className="font-semibold">Already in the Low range. These habits may keep it gentle.</p>
          )}
          <p className="text-xs mt-1 opacity-80">
            Illustration only, based on general patterns. Not measured or guaranteed; your body may respond differently, and adding more fixes does not multiply the effect.
          </p>
        </div>
      )}

      <h2 className="font-display text-xl mt-7">Gentle fixes</h2>
      <HearSummary log={log} />
      <div className="mt-3 space-y-2">
        {fixes.map(({ type, label, icon: Icon }) => {
          const on = applied.includes(type);
          return (
            <button
              key={type}
              data-testid={`button-fix-${type}`}
              onClick={() => (on ? onUnfix(type) : onFix(type))}
              aria-pressed={on}
              className={`w-full flex items-center gap-3 rounded-2xl p-4 text-left border transition-all active:scale-[0.98] ${
                on ? 'bg-foreground text-background border-foreground' : 'bg-card border-card-border hover:border-foreground/40'
              }`}
            >
              <span className={`rounded-xl p-2 ${on ? 'bg-accent text-accent-foreground' : 'bg-muted'}`}><Icon className="w-5 h-5" /></span>
              <span className="flex-1 font-medium">{label}</span>
              <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${on ? 'border-accent bg-accent text-accent-foreground scale-110' : 'border-input'}`}>
                {on && <Check className="w-3.5 h-3.5" />}
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" onClick={onOpenSettings} data-testid="button-movement-settings" className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
        Movement settings
      </button>
      {settingsForm}
      {doctorNote && !applied.includes('walk') && (
        <div role="status" className="mt-3 rounded-2xl bg-secondary text-secondary-foreground p-4 rise" data-testid="text-doctor-note">
          <p className="font-semibold">{DOCTOR_MSG}</p>
          <p className="text-xs mt-1 opacity-80">These fixes do not involve movement:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!applied.includes('food_order') && (
              <button onClick={() => onFix('food_order')} data-testid="button-doctor-food-order" className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-semibold">Eat veggies/protein first</button>
            )}
            {!applied.includes('swap') && (
              <button onClick={() => onFix('swap')} data-testid="button-doctor-swap" className="rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold">{est.swaps[0] ?? 'Try a lighter swap'}</button>
            )}
          </div>
        </div>
      )}

      {applied.includes('walk') && moveType !== 'walk' && (
        <MovementRoutine key={`${log.id}-${moveType}`} log={log} type={moveType} onStart={onMoveStart} onComplete={onMoveComplete} onUndo={onMoveUndo} />
      )}
      {applied.includes('walk') && moveType === 'walk' && (
        <WalkSuggestion key={log.id} log={log} onStart={onWalkStart} onComplete={onWalkComplete} onUndo={() => onWalk(false)} />
      )}

      {est.swaps.length > 1 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Other swap ideas</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground list-disc pl-5">
            {est.swaps.slice(1).map((sw) => <li key={sw}>{sw}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold">On the plate</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {est.foods.map((f, i) => (
            <span key={i} className="rounded-full bg-muted px-3 py-1 text-sm">
              {f.name} <span className="font-mono text-xs text-muted-foreground">{f.portion}</span>
            </span>
          ))}
        </div>
      </div>

      <button data-testid="button-new-meal" onClick={onNew} className="mt-8 w-full rounded-full border border-input py-4 font-semibold flex items-center justify-center gap-2">
        <RotateCcw className="w-4 h-4" /> Read another plate
      </button>
    </section>
  );
}
