/**
 * editMessageText that shrugs off Telegram's "message is not modified" error
 * (thrown when the new text + buttons are identical to what is already shown,
 * e.g. tapping the mode that is already selected).
 */
export async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (!/message is not modified/i.test(err?.description || err?.message || '')) throw err;
  }
}
