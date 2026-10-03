// The bot sometimes needs the owner's NEXT plain-text message (a new step size,
// a mute time, a test price). This tracks that, one active flow per user.
//
// It's in-memory on purpose: if the bot restarts mid-flow the owner just taps
// the button again. Tapping any main-menu button cancels a waiting flow (see
// bot.js), so a button press is never mistaken for an answer.
const flows = new Map(); // userId -> { type, ...data }

export const pending = {
  set(userId, type, data = {}) {
    flows.set(userId, { type, ...data });
  },
  get(userId, type) {
    const flow = flows.get(userId);
    return flow && flow.type === type ? flow : null;
  },
  clear(userId) {
    flows.delete(userId);
  },
};
