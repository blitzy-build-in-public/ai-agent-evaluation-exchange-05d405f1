/**
 * One bounded pool for this workspace's parallel reads.
 *
 * A page that needs several independent reads asks for them together rather than one after the
 * other, and the number of them in flight at once is the caller's bound rather than the length of
 * the list: the API is one process whose storage calls are synchronous, so a burst wider than the
 * bound queues behind the writer without finishing any sooner, and a catalogue or an account with
 * many items would otherwise arrive as one burst that grows with the data.
 *
 * The semantics are `Promise.all`'s apart from the bound, which is what lets a caller keep the error
 * behaviour it already has: every item is processed exactly once, the results keep the items' own
 * order, and a failure rejects the returned promise.
 */

/**
 * Runs `run` over every item with at most `limit` calls in flight at once, and returns the results
 * in the order the items were given.
 *
 * The first call is made for the first item, the second for the second and so on, so the items are
 * handed out in order; each call starts as soon as the bound allows it, so the results of a shorter
 * call never hold up a longer one. Nothing is cancelled: once a call has been made it is left to
 * settle, and a call that fails stops any further item from starting, whichever call it was — the
 * returned promise rejects with that first failure.
 *
 * @param items The values to process, in the order the results must come back in.
 * @param limit How many calls may be in flight at once. A bound that is not a whole number of one or
 *   more is read as one, so a caller that passes a bound it did not mean still reads every item.
 * @param run The call to make for one item.
 * @returns Every result, in the items' own order.
 * @throws {unknown} The first failure any call raised, once the calls already made have settled.
 */
export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const bound = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;

  // One shared cursor over the items, so the workers hand each other the next item rather than
  // slicing the list up front: a list shorter than the bound starts one worker per item, and a call
  // that happens to be slow never leaves another worker idle while work remains.
  const queue = items.entries();
  const results: Result[] = new Array<Result>(items.length);
  let failure: { readonly error: unknown } | null = null;

  async function drain(): Promise<void> {
    for (const [index, item] of queue) {
      if (failure !== null) {
        // A later worker starts no new item once one has failed, so a failure costs at most the
        // calls that were already in flight.
        return;
      }
      try {
        results[index] = await run(item);
      } catch (error: unknown) {
        failure = { error };
        throw error;
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let started = 0; started < Math.min(bound, items.length); started += 1) {
    workers.push(drain());
  }
  await Promise.all(workers);

  return results;
}
