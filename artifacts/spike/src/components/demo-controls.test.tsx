import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { trackSpikeEvent } from '@workspace/api-client-react';
import { DemoControls } from './demo-controls';
import { demoLoaded, loadLogs, LOGS_CHANGED } from '@/lib/spike';
import { ACTIVE_KEY, DEMO_KEY, PERSONAL_KEY, seedHistories } from '@/test/meal-fixtures';

describe('DemoControls with real meal storage', () => {
  it('loads and clears demo across placements while restoring untouched personal history', () => {
    const { personal, personalRaw } = seedHistories();
    render(<><DemoControls placement="home" /><DemoControls placement="week" /></>);
    expect(screen.queryByText('Clear demo data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-load-demo-home'));
    expect(loadLogs()).toHaveLength(14);
    expect(screen.getAllByText('Clear demo data')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('button-clear-demo-week'));
    expect(screen.queryByText('Clear demo data')).not.toBeInTheDocument();
    expect(loadLogs()).toEqual(personal);
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
    expect(trackSpikeEvent).not.toHaveBeenCalled();
  });

  it('refreshes on app changes and cross-tab storage events, and cleans up listeners', () => {
    seedHistories();
    const { unmount } = render(<DemoControls placement="home" />);
    // App events originate in the real storage helpers.
    fireEvent.click(screen.getByTestId('button-load-demo-home'));
    expect(screen.getByText('Clear demo data')).toBeInTheDocument();
    localStorage.removeItem(ACTIVE_KEY);
    fireEvent(window, new StorageEvent('storage', { key: ACTIVE_KEY }));
    expect(screen.queryByText('Clear demo data')).not.toBeInTheDocument();
    localStorage.setItem(ACTIVE_KEY, 'true');
    fireEvent(window, new StorageEvent('storage', { key: ACTIVE_KEY }));
    expect(screen.getByText('Clear demo data')).toBeInTheDocument();
    const remove = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith(LOGS_CHANGED, expect.any(Function));
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it.each([DEMO_KEY, ACTIVE_KEY])('shows failed demo load at %s without switching history, then retries', (failedKey) => {
    const { personal, personalRaw } = seedHistories();
    render(<DemoControls placement="home" />);
    const set = Storage.prototype.setItem;
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === failedKey) throw new Error('Full');
      set.call(this, key, value);
    });
    fireEvent.click(screen.getByTestId('button-load-demo-home'));
    expect(screen.getByRole('alert')).toHaveTextContent('Device storage may be full or blocked.');
    expect(screen.queryByText('Clear demo data')).not.toBeInTheDocument();
    expect(demoLoaded()).toBe(false);
    expect(loadLogs()).toEqual(personal);
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
    failure.mockRestore();
    fireEvent.click(screen.getByTestId('button-load-demo-home'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Clear demo data')).toBeInTheDocument();
  });

  it.each([DEMO_KEY, ACTIVE_KEY])('shows failed clear at %s without switching history, then retries', (failedKey) => {
    const { demo, personal, personalRaw } = seedHistories(true);
    render(<DemoControls placement="home" />);
    const remove = Storage.prototype.removeItem;
    const failure = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === failedKey) throw new Error('Blocked');
      remove.call(this, key);
    });
    fireEvent.click(screen.getByTestId('button-clear-demo-home'));
    expect(screen.getByRole('alert')).toHaveTextContent('Demo data could not be changed.');
    expect(screen.getByText('Clear demo data')).toBeInTheDocument();
    expect(demoLoaded()).toBe(true);
    expect(loadLogs()).toEqual(demo);
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
    failure.mockRestore();
    fireEvent.click(screen.getByTestId('button-clear-demo-home'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Clear demo data')).not.toBeInTheDocument();
    expect(loadLogs()).toEqual(personal);
  });
});
