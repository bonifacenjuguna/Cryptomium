/**
 * editMessageText that shrugs off Telegram's "message is not modified" error
 * (thrown when the new text + buttons are identical to what is already shown,
 * e.g. tapping the mode that is already selected).
 * Returns true if the message was changed, false if it was already identical.
 */
export async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
    return true;
  } catch (err) {
    if (/message is not modified/i.test(err?.description || err?.message || '')) return false;
    throw err;
  }
}
