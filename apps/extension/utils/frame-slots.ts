// Keep the beginning, latest frame, and a reservoir spanning the recording.
// At most 16 private objects exist per video even during a long capture.
export function frameSlots(index: number, random: () => number = Math.random): number[] {
  if (index === 0) return [0, 15];
  if (index <= 14) return [index, 15];
  const choice = Math.floor(random() * index);
  return choice < 14 ? [choice + 1, 15] : [15];
}
