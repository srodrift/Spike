import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// No real API module is imported: analytics can never reach the server relay
// (and therefore Mixpanel), even in tests exercising non-demo event emission.
vi.mock('@workspace/api-client-react', () => ({
  trackSpikeEvent: vi.fn().mockResolvedValue({}),
  useEstimateMeal: () => ({ mutate: vi.fn() }),
  estimateMeal: vi.fn(() => { throw new Error('Meal analysis is outside these tests'); }),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Fail closed if a new code path tries to contact any external service.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is disabled in walk tests'); }));
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {
    throw new Error('XHR is disabled in walk tests');
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});
