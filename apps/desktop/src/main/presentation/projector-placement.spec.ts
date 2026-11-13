import { describe, expect, it } from 'vitest';

import { placeProjector } from './projector-placement';

const laptop = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
const projector = {
  id: 2,
  bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
};
const tv = { id: 3, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };

describe('placeProjector', () => {
  it('uses the chosen display when it is connected', () => {
    expect(placeProjector([laptop, projector, tv], 1, 3)).toEqual({
      mode: 'showing',
      display: tv,
    });
  });

  it('waits, rather than falling back, when the chosen display is disconnected', () => {
    expect(placeProjector([laptop, projector], 1, 3)).toEqual({
      mode: 'display-missing',
    });
    expect(placeProjector([laptop], 1, 2)).toEqual({ mode: 'display-missing' });
  });

  it('picks the first non-primary display when none was chosen', () => {
    expect(placeProjector([laptop, projector], 1, null)).toEqual({
      mode: 'showing',
      display: projector,
    });
  });

  it('opens a normal window on a single display', () => {
    expect(placeProjector([laptop], 1, null)).toEqual({
      mode: 'windowed',
      display: laptop,
    });
  });
});
