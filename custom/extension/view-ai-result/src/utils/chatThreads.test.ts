import {
  createThread,
  deriveThreadTitle,
  formatRelativeTime,
  loadThreads,
  MAX_THREADS,
  NEW_THREAD_TITLE,
  newThreadId,
  parseThreads,
  pruneThreads,
  removeThread,
  saveThreads,
  sortThreads,
  upsertThread,
  type ChatThread,
  type ThreadStorage,
} from './chatThreads';
import type { ChatMessage } from '../types/chatTypes';

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m-${Math.random()}`,
  role: 'user',
  content: 'hello',
  timestamp: new Date('2026-08-14T10:00:00Z'),
  ...over,
});

/** In-memory Storage double, optionally failing writes to simulate a quota. */
function makeStorage(opts: { failFirst?: number; throwOnRead?: boolean } = {}) {
  let data: Record<string, string> = {};
  let fails = opts.failFirst ?? 0;
  return {
    getItem(k: string) {
      if (opts.throwOnRead) {
        throw new Error('storage disabled');
      }
      return data[k] ?? null;
    },
    setItem(k: string, v: string) {
      if (fails > 0) {
        fails -= 1;
        throw new Error('QuotaExceededError');
      }
      data[k] = v;
    },
    raw: () => data,
    reset: () => {
      data = {};
    },
  } as ThreadStorage & { raw: () => Record<string, string>; reset: () => void };
}

describe('newThreadId', () => {
  it('never repeats within a session', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newThreadId()));
    expect(ids.size).toBe(50);
  });
});

describe('deriveThreadTitle', () => {
  it('titles a thread from its first user turn', () => {
    expect(
      deriveThreadTitle([
        message({ role: 'user', content: 'Is this lesion suspicious?' }),
        message({ role: 'assistant', content: 'It appears irregular.' }),
      ])
    ).toBe('Is this lesion suspicious?');
  });

  it('ignores assistant and event turns when choosing a title', () => {
    // An assistant turn opens with whatever the model said, and an event turn is
    // panel metadata — neither describes the conversation.
    expect(
      deriveThreadTitle([
        message({ role: 'assistant', content: 'Certainly! Here is my reading.' }),
        message({ role: 'event', content: 'Model changed to MiniMax M3' }),
        message({ role: 'user', content: 'What about the left side?' }),
      ])
    ).toBe('What about the left side?');
  });

  it('collapses whitespace so a multi-line question stays one line', () => {
    expect(deriveThreadTitle([message({ content: '  What is\n\n  this?  ' })])).toBe(
      'What is this?'
    );
  });

  it('elides a long question', () => {
    const title = deriveThreadTitle([message({ content: 'x'.repeat(200) })]);
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to a placeholder with no user turn yet', () => {
    expect(deriveThreadTitle([])).toBe(NEW_THREAD_TITLE);
    expect(deriveThreadTitle([message({ role: 'user', content: '   ' })])).toBe(NEW_THREAD_TITLE);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-14T12:00:00Z').getTime();
  const ago = (ms: number) => formatRelativeTime(now - ms, now);

  it('describes recency coarsely', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(30 * 1000)).toBe('just now');
    expect(ago(5 * 60 * 1000)).toBe('5m ago');
    expect(ago(3 * 60 * 60 * 1000)).toBe('3h ago');
    expect(ago(50 * 60 * 60 * 1000)).toBe('2d ago');
  });

  it('does not report a future timestamp as negative', () => {
    // Clock skew between tabs must not render "-3m ago".
    expect(formatRelativeTime(now + 60000, now)).toBe('just now');
  });
});

describe('thread list operations', () => {
  const thread = (id: string, updatedAt: number): ChatThread =>
    createThread({ id, updatedAt, createdAt: updatedAt });

  it('sorts newest first', () => {
    const sorted = sortThreads([thread('a', 100), thread('b', 300), thread('c', 200)]);
    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('replaces a thread in place rather than duplicating it', () => {
    const initial = [thread('a', 100), thread('b', 200)];
    const updated = upsertThread(initial, { ...thread('a', 300), title: 'renamed' });
    expect(updated.map(t => t.id)).toEqual(['a', 'b']);
    expect(updated.find(t => t.id === 'a')!.title).toBe('renamed');
  });

  it('drops the least recently touched beyond the cap', () => {
    const many = Array.from({ length: MAX_THREADS + 5 }, (_, i) => thread(`t${i}`, i));
    const pruned = pruneThreads(many);
    expect(pruned).toHaveLength(MAX_THREADS);
    // t0..t4 are oldest and must be the ones dropped.
    expect(pruned.some(t => t.id === 't0')).toBe(false);
    expect(pruned.some(t => t.id === `t${MAX_THREADS + 4}`)).toBe(true);
  });

  it('removes by id', () => {
    expect(removeThread([thread('a', 1), thread('b', 2)], 'a').map(t => t.id)).toEqual(['b']);
  });
});

describe('persistence round-trip', () => {
  it('restores messages with real Date timestamps', () => {
    // JSON turns Date into a string; a revived message must still be able to
    // call toLocaleTimeString() when rendered.
    const storage = makeStorage();
    const t = createThread({ messages: [message({ id: 'm1', content: 'hi' })] });
    saveThreads([t], storage);

    const [restored] = loadThreads(storage);
    expect(restored.messages[0].content).toBe('hi');
    expect(restored.messages[0].timestamp).toBeInstanceOf(Date);
    expect(restored.messages[0].timestamp.toISOString()).toBe('2026-08-14T10:00:00.000Z');
  });

  it('preserves the per-message context snapshot', () => {
    // The snapshot is the whole point of the transcript — it must survive a
    // reload, since it exists nowhere else.
    const storage = makeStorage();
    const snapshot = {
      studyInstanceUID: 'study-1',
      studyLabel: '2026-08-12 · Breast MRI',
      series: [
        { seriesInstanceUID: 'se-1', description: 'Ax T1 post', modality: 'MR', numFrames: 103 },
      ],
      provider: 'cloud' as const,
      model: 'gemma4:31b',
      sliceRecipe: { numSlices: 5, strategy: 'central', centralPercentage: 60 },
      requestedImageCount: 5,
    };
    saveThreads([createThread({ messages: [message({ promptContext: snapshot })] })], storage);

    const [restored] = loadThreads(storage);
    expect(restored.messages[0].promptContext).toEqual(snapshot);
  });

  it('clears a streaming flag left behind by a reload', () => {
    // Nothing is in flight after a reload; the spinner would otherwise never stop.
    const storage = makeStorage();
    saveThreads([createThread({ messages: [message({ isStreaming: true })] })], storage);
    expect(loadThreads(storage)[0].messages[0].isStreaming).toBe(false);
  });

  it('substitutes the thread time for an unreadable message timestamp', () => {
    // "Invalid Date" in a clinical transcript reads as a defect; an approximate
    // time reads as approximate.
    const threads = parseThreads(
      JSON.stringify([
        {
          id: 't1',
          title: 'x',
          createdAt: 1000,
          updatedAt: 5000,
          serverSessionId: null,
          messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 'not-a-date' }],
        },
      ])
    );
    expect(threads[0].messages[0].timestamp.getTime()).toBe(5000);
  });

  it('treats unreadable storage as no history rather than throwing', () => {
    expect(parseThreads(null)).toEqual([]);
    expect(parseThreads('{not json')).toEqual([]);
    // A JSON value of the wrong shape must not produce half-built threads.
    expect(parseThreads('{"a":1}')).toEqual([]);
    expect(parseThreads('[1,2,3]')).toEqual([]);
    expect(loadThreads(makeStorage({ throwOnRead: true }))).toEqual([]);
  });

  it('drops malformed messages but keeps the rest of the thread', () => {
    const threads = parseThreads(
      JSON.stringify([
        {
          id: 't1',
          createdAt: 1,
          updatedAt: 2,
          messages: [null, { role: 'user' }, { id: 'ok', role: 'user', content: 'kept' }],
        },
      ])
    );
    expect(threads[0].messages).toHaveLength(1);
    expect(threads[0].messages[0].content).toBe('kept');
  });

  it('works with no storage at all', () => {
    // Storage can be disabled by browser policy; the panel must still function
    // for the current session.
    expect(loadThreads(null)).toEqual([]);
    const kept = saveThreads([createThread()], null);
    expect(kept).toHaveLength(1);
  });
});

describe('quota handling', () => {
  it('sheds the oldest threads and retries rather than persisting nothing', () => {
    const storage = makeStorage({ failFirst: 1 });
    const threads = Array.from({ length: 8 }, (_, i) =>
      createThread({ id: `t${i}`, updatedAt: i, createdAt: i })
    );
    const written = saveThreads(threads, storage);
    expect(written.length).toBeLessThan(8);
    expect(written.length).toBeGreaterThan(0);
    // What survived is the most recent, not an arbitrary slice.
    expect(written[0].id).toBe('t7');
    expect(JSON.parse(storage.raw()['odelia.chat.threads.v1'])).toHaveLength(written.length);
  });

  it('gives up gracefully when even one thread will not fit', () => {
    const storage = makeStorage({ failFirst: 99 });
    expect(() => saveThreads([createThread()], storage)).not.toThrow();
  });
});
