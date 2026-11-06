import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { saveMovementSettings, type MovementSettings } from '@/lib/movement';

type YN = boolean | null;

function YesNo({ id, label, value, onChange }: { id: string; label: string; value: YN; onChange: (v: boolean) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 flex gap-2" role="radiogroup">
        {[true, false].map((v) => (
          <label key={String(v)} className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40 ${value === v ? 'bg-foreground text-background border-foreground' : 'bg-card border-input'}`}>
            <input type="radio" name={id} className="sr-only" checked={value === v} onChange={() => onChange(v)} data-testid={`radio-${id}-${v ? 'yes' : 'no'}`} />
            {v ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const PLACES: { v: MovementSettings['location']; label: string }[] = [
  { v: 'out', label: 'Out and about' },
  { v: 'home', label: 'At home' },
  { v: 'desk', label: 'At my desk' },
];

export function MovementSettingsForm({
  initial,
  onSaved,
  onCancel,
  retryOnly = false,
}: {
  initial: MovementSettings | null;
  onSaved: (s: MovementSettings) => void;
  onCancel: () => void;
  retryOnly?: boolean;
}) {
  const [pain, setPain] = useState<YN>(initial?.pain ?? null);
  const [doctor, setDoctor] = useState<YN>(initial?.doctorLimit ?? null);
  const [loc, setLoc] = useState<MovementSettings['location'] | null>(initial?.location ?? null);
  const [err, setErr] = useState<string | null>(null);
  const ready = pain !== null && doctor !== null && loc !== null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) {
      setErr('Please answer all three questions.');
      return;
    }
    const s: MovementSettings = { pain, doctorLimit: doctor, location: loc };
    try {
      saveMovementSettings(s);
    } catch {
      setErr('Could not save on this device (storage may be full or blocked). Nothing was changed.');
      return;
    }
    setErr(null);
    onSaved(s);
  };

  return (
    <form onSubmit={submit} className="mt-3 rounded-3xl border border-card-border bg-card p-4 rise" aria-labelledby="movement-form-title" data-testid="form-movement-settings">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p id="movement-form-title" className="font-display text-lg leading-tight">Quick movement check</p>
          <p className="text-xs text-muted-foreground mt-0.5">So we suggest something that fits. Answers stay on this device only.</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close movement check" data-testid="button-movement-cancel" className="p-1.5 rounded-full hover:bg-muted">
          <X className="w-4 h-4" />
        </button>
      </div>
      {retryOnly && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="text-movement-retry">
        Update this meal's history before changing these saved safety answers. Retry when device storage is available.
      </p>}
      <fieldset disabled={retryOnly}>
        <YesNo id="pain" label="Any injury or pain that limits walking or standing?" value={pain} onChange={setPain} />
        <YesNo id="doctor" label="Has a doctor told you to limit exercise?" value={doctor} onChange={setDoctor} />
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Where are you right now?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLACES.map((p) => (
              <label key={p.v} className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40 ${loc === p.v ? 'bg-foreground text-background border-foreground' : 'bg-card border-input'}`}>
                <input type="radio" name="location" className="sr-only" checked={loc === p.v} onChange={() => setLoc(p.v)} data-testid={`radio-location-${p.v}`} />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      {err && (
        <p role="alert" className="mt-3 rounded-2xl bg-destructive/10 text-destructive p-3 text-sm flex gap-2" data-testid="text-movement-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {err}
        </p>
      )}
      <button type="submit" disabled={!ready} data-testid="button-movement-save" className="mt-4 w-full rounded-full bg-primary text-primary-foreground py-3 font-semibold disabled:opacity-40">
        {retryOnly ? 'Retry history update' : 'Save'}
      </button>
    </form>
  );
}
