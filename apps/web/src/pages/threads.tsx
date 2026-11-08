/**
 * The `/threads` page: the public discussion board and the thread a reader has open.
 *
 * The board is the contributor-facing surface of the product — the place a standard, a proposal, a
 * fixture set or a piece of evidence is discussed — so it is open to any demo account. Starting a
 * thread and posting a reply both accept whichever synthetic account the header's switcher has
 * selected, which is why this page renders no role gate: a `403` cannot occur on either write, and
 * a sentence explaining one would describe a refusal the contract does not have. The only write
 * failure a reader of this page can meet is a `401`, and that belongs to the form components, which
 * own their own field, their own explanation and their own polite announcement.
 *
 * Four decisions shape this file.
 *
 * **The address is the selection.** Which thread is open lives in the `id` query parameter and
 * nowhere else: no context provider, no shared state module, no storage. A thread is therefore a
 * link a contributor can paste, the back button steps through the threads that were opened, and a
 * selection the page of the board cannot resolve renders an explanation with a way back to the
 * board rather than an empty panel.
 *
 * **One read, and re-read rather than patched.** `../api-client` is the only module that calls the
 * API, and this page makes exactly one kind of call through it: `listThreads`. After a thread is
 * started or a reply is posted, the board is read again instead of being merged from the response,
 * so what a reader sees is what the service returned, in the service's own order. Both the board
 * and a thread's posts are ordered by the service, and a row this page appended locally would be
 * this page's guess at where that row belongs.
 *
 * **A refresh keeps the rows that are already on screen.** Re-reading never blanks the board: the
 * loading state belongs to the first read, and a later read that fails leaves the board readable
 * with the failure explained beside it. A read is also marked in flight the moment it is asked for,
 * because a selection written a moment earlier must not be judged — and so announced as unknown —
 * against the board it is about to replace.
 *
 * **Append-only is what the surface shows.** A thread's replies read in the order they were
 * written and nothing on this page edits, hides or removes one; the reply field adds a row and the
 * board is read again. That is the whole of the interaction, which is why a thread with no reply
 * renders an explanation and an invitation rather than an empty list.
 *
 * Presentation only. No request is built here, no header is set, no storage is touched and no
 * business rule lives in this file: every payload and count is rendered as the service returned it,
 * a timestamp through the workspace's one reading of a stored instant, a row's author named by the
 * handle the switcher lists that account under and a reply rendered with the paragraph breaks its
 * author wrote. Appearance comes from the workspace stylesheet, whose `.item-list` pair is the
 * thread board's own class, and no stylesheet is imported from this module.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { COLLECTION_PAGE_SIZE } from "@adem/shared";
import type { Thread, ThreadPost } from "@adem/shared";
import { listThreads } from "../api-client";
import type { ThreadListItem } from "../api-client";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { ThreadCreateForm, ThreadReplyForm } from "../components/thread-reply-form";
import { findDemoAccount } from "../data/demo-accounts";
import { Timestamp, readString } from "../payload-reading";

/**
 * The query parameter that names the open thread. It is this page's only selection state, and it is
 * spelled here rather than shared because no other module reads or writes it.
 */
const THREAD_ID_PARAM = "id";

/**
 * The create region's `id`. The empty board's action focuses that region, and an `id` is what lets
 * the region be reached without this page holding a reference to a field inside a component it does
 * not own.
 */
const CREATE_REGION_ID = "thread-start";

/** The board read in flight. It is the only content of the board's live region while one is. */
const LOADING_MESSAGE = "Loading the discussion board…";

/** The page title, and the one sentence under it that says what the board is and who may post. */
const PAGE_HEADING = "Discussions";
const PAGE_SUMMARY =
  "An open place to discuss standards, proposals and contributions, where any demo account may start a thread or reply to one.";

/** The two section headings the page's own affordances sit under. */
const CREATE_HEADING = "Start a thread";
const BOARD_HEADING = "The board";
const REPLIES_LABEL = "Replies";
const REPLY_HEADING = "Post a reply";
const BACK_TO_BOARD_LABEL = "Back to the board";

/** The empty board: a state of the product, stated with the action that leaves it. */
const EMPTY_BOARD_HEADING = "No discussion has started yet";
const EMPTY_BOARD_EXPLANATION =
  "The board holds no thread yet. Any demo account may open the first one, and every reply after it is appended to the thread.";
const START_FIRST_THREAD_LABEL = "Start the first thread";

/** A thread nobody has answered yet: the state of an append-only post list before its first row. */
const EMPTY_POSTS_HEADING = "No replies yet";
const EMPTY_POSTS_EXPLANATION =
  "This thread has no replies. The reply field below posts the first one; a reply is appended and neither it nor an earlier one is ever edited or removed.";

/**
 * The selection the page of the board could not resolve. It names what the address says and the
 * ways such an address is reached — the thread is on an earlier page of the board, or the link was
 * made against another copy of the demonstration, or against a board that has since been reset —
 * because a reader who followed a link deserves to know which of them happened rather than being
 * shown an empty thread.
 */
const UNKNOWN_THREAD_HEADING = "That thread is not on this page of the board";
const UNKNOWN_THREAD_EXPLANATION =
  "This address names a thread the page of the board read here does not carry. The board is read one page at a time, most recent first, so the thread may be on an earlier page of the board; a link made against another copy of the demonstration, or against a board that has since been reset, reaches this state too.";

/**
 * What a row says about its author when the board names an account the switcher does not list. The
 * identifier itself is deliberately not rendered: it names nothing a reader can recognise, and the
 * handle is the whole of the attribution this board shows.
 */
const AUTHOR_UNLISTED_LABEL = "an account the demo-account switcher does not list";

/**
 * The thread a `?id=` value names, or `null` when the parameter is absent or blank.
 *
 * A blank value is treated as no selection rather than as an identifier nothing matches: `?id=` is
 * an address that asks for no thread, and answering it with the not-on-the-board explanation would
 * report a mistake the reader did not make.
 */
function readSelectedThreadId(params: URLSearchParams): string | null {
  const raw = params.get(THREAD_ID_PARAM);
  if (raw === null) {
    return null;
  }
  const threadId = raw.trim();
  return threadId === "" ? null : threadId;
}

/**
 * The address that opens one thread: this page's own route with the selection in its query.
 *
 * Only the selection travels in the address, so the board keeps the route a reader can reach from
 * the navigation while a thread stays linkable. The identifier is encoded because it is opaque.
 */
function threadPath(threadId: string): string {
  return `/threads?${THREAD_ID_PARAM}=${encodeURIComponent(threadId)}`;
}

/** How many replies a thread holds, counted from the posts the read returned with it. */
function describePostCount(count: number): string {
  return count === 1 ? "1 post" : `${count} posts`;
}

/**
 * The account that wrote a thread or a reply, named by the handle the demo-account switcher lists
 * its identifier under.
 *
 * The handle is the whole of the attribution: it is one of the six synthetic demo accounts, so a
 * row names which demonstration account wrote it and says nothing further about who that was.
 * Both thread writes accept any resolvable demo account, so every author this board can hold is one
 * of those six; an identifier the lookup does not know — an account the switcher no longer lists, or
 * a payload written by hand — states that much instead of putting an opaque identifier in front of
 * a reader.
 */
function describeAuthor(accountId: string): string {
  const account = findDemoAccount(accountId);
  return account === null ? AUTHOR_UNLISTED_LABEL : account.handle;
}

/**
 * A reply's body as the paragraphs its author wrote.
 *
 * A stored body keeps the blank lines the reply field submitted, and wrapping the whole of it in one
 * paragraph would keep those newlines in the markup while a reader sees a single block of text,
 * because no stylesheet rule here preserves them. Splitting on a blank line — a line break, then any
 * run of spaces, tabs or further line breaks, then another line break — and rendering one paragraph
 * per non-empty piece is what makes the structure the author typed reach the reader, and it is the
 * whole of the formatting this page adds: each piece is still text, escaped by the renderer, and
 * never markup.
 *
 * A body with no blank line in it is a single piece and renders exactly as it did before, and a body
 * whose pieces are all blank still renders one paragraph rather than disappearing, so a reply is
 * never invisible.
 */
function readPostParagraphs(body: unknown): readonly string[] {
  const paragraphs = readString(body)
    .split(/\n\s*\n/)
    .map((paragraph: string): string => paragraph.trim())
    .filter((paragraph: string): boolean => paragraph !== "");
  return paragraphs.length === 0 ? [""] : paragraphs;
}

/**
 * What the board's live region says once a read has settled. The count is the one fact a reader
 * cannot see from the list itself when it is long, and it is what tells a reader who just started a
 * thread that the board has taken it.
 *
 * The read answers one page of the board, so the count is the board's own only while the page came
 * back shorter than {@link COLLECTION_PAGE_SIZE}: a page that came back full may hold the newest
 * threads of a longer board, and the sentence says which of the two it is rather than stating a
 * size the read did not confirm.
 */
function describeLoadedBoard(count: number): string {
  if (count === 0) {
    return "The board is loaded and holds no thread yet.";
  }
  const loaded = count === 1 ? "one thread" : `${count} threads`;
  return count < COLLECTION_PAGE_SIZE
    ? `The board is loaded with ${loaded} on it.`
    : `The board's most recent page is loaded, holding ${loaded}.`;
}

/**
 * The sentence the board's live region carries, or `null` when it should carry none.
 *
 * It is `null` in exactly two situations, and both matter. While a later read is in flight over
 * rows that are already on screen there is no state worth announcing, because nothing a reader can
 * see is about to change. And when the first read failed there is nothing to announce here either:
 * the error notice beside this region is the explanation, and a second, vaguer sentence from this
 * region would be the duplicate a screen-reader user hears first.
 */
function describeBoardStatus(
  threads: readonly ThreadListItem[] | null,
  isLoading: boolean,
): string | null {
  if (threads !== null) {
    return isLoading ? null : describeLoadedBoard(threads.length);
  }
  return isLoading ? LOADING_MESSAGE : null;
}

/**
 * The discussion board and the thread a reader has open.
 *
 * This page owns the route's single `<main>` landmark and its single `<h1>`, so the shell — which
 * renders the header, the navigation, the demonstration banner and the account switcher — must not
 * wrap it in another landmark. The outline it produces is `h1`, then the board's own `h2`s, then an
 * `h3` for a thread's first reply and for the reply field, so no level is skipped.
 */
export function Threads(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  // The board, the state of the read that produced it, and the counter that asks for another one.
  // `null` rows mean no read has produced a board yet, which is what separates the first read — the
  // only one that shows a loading state — from every later read, which keeps what is on screen.
  const [threads, setThreads] = useState<readonly ThreadListItem[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [readError, setReadError] = useState<unknown>(null);
  const [readCount, setReadCount] = useState<number>(0);

  // The create region, focused by the empty board's action. It is the region rather than the field
  // inside it: the field belongs to a component this page does not own, and the region is what the
  // action's own label names.
  const createRegionRef = useRef<HTMLElement | null>(null);

  const selectedId = readSelectedThreadId(searchParams);

  const selectedThread: ThreadListItem | null =
    threads === null || selectedId === null
      ? null
      : (threads.find((thread: ThreadListItem): boolean => thread.id === selectedId) ?? null);

  // A selection that resolves to nothing is only reportable once a read has settled over rows the
  // page actually holds. While a read is in flight the selection is a question still being
  // answered, and after a failed read the board on screen is not the board the address was written
  // against, so neither state claims the thread is missing.
  const isSelectionUnknown =
    readError === null && !isLoading && threads !== null && selectedId !== null && selectedThread === null;

  const boardStatus = describeBoardStatus(threads, isLoading);

  /**
   * Read the board again.
   *
   * The read is marked in flight here rather than only in the effect, because this is the moment a
   * caller knows the board on screen is stale: a thread started a moment ago is already selected in
   * the address, and it must not be reported as missing while the effect that will fetch it has yet
   * to run.
   */
  const reload = useCallback((): void => {
    setIsLoading(true);
    setReadCount((previous: number): number => previous + 1);
  }, []);

  /** Open one thread by writing only the selection into the address. */
  const selectThread = useCallback(
    (threadId: string): void => {
      const next = new URLSearchParams(searchParams);
      next.set(THREAD_ID_PARAM, threadId);
      if (next.toString() === searchParams.toString()) {
        return;
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  /**
   * The board read, and the only effect this page has.
   *
   * The cancelled flag is what keeps a reader from being shown a board twice: the read is asked for
   * when the address changes nothing about it but the reload counter turns, and a response that
   * arrives after a newer one has been requested is discarded rather than rendered.
   */
  useEffect((): (() => void) => {
    let cancelled = false;

    setIsLoading(true);
    setReadError(null);

    listThreads().then(
      (rows: readonly ThreadListItem[]): void => {
        if (cancelled) {
          return;
        }
        setThreads(rows);
        setIsLoading(false);
      },
      (failure: unknown): void => {
        if (cancelled) {
          return;
        }
        setReadError(failure);
        setIsLoading(false);
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [readCount]);

  /**
   * A thread was started: open it, then read the board again.
   *
   * Both halves are needed. The selection is what makes the new thread the one shown below, and the
   * read is what places it among the others in the order the service keeps rather than at a
   * position this page chose.
   */
  const handleThreadCreated = useCallback(
    (thread: Thread): void => {
      selectThread(thread.id);
      reload();
    },
    [reload, selectThread],
  );

  /**
   * A reply was posted: read the board again.
   *
   * The post itself needs no handling, and taking none is deliberate. The form announces the reply
   * it wrote, and the read is what puts the reply on screen in the thread's own order — a row
   * appended here would be this page's assumption about where an append-only store placed it.
   */
  const handleReplyPosted = useCallback((): void => {
    reload();
  }, [reload]);

  /** Move focus to the create region, which is the empty board's one next step. */
  const focusCreateRegion = useCallback((): void => {
    createRegionRef.current?.focus();
  }, []);

  return (
    // `id` is the target the shell's skip link points at, and `tabIndex={-1}` is what lets that
    // link move focus here without putting the landmark itself in the tab order.
    <main id="main-content" tabIndex={-1} className="page page-threads">
      <section aria-labelledby="threads-page-heading">
        <h1 id="threads-page-heading">{PAGE_HEADING}</h1>
        <p>{PAGE_SUMMARY}</p>
      </section>

      {/* The create affordance, and the region the empty board's action focuses. `tabIndex={-1}` is
          what makes the region focusable by that action without adding a stop to the tab order. */}
      <section
        id={CREATE_REGION_ID}
        ref={createRegionRef}
        tabIndex={-1}
        aria-labelledby="threads-create-heading"
      >
        <h2 id="threads-create-heading">{CREATE_HEADING}</h2>
        <ThreadCreateForm onCreated={handleThreadCreated} />
      </section>

      <section aria-labelledby="threads-board-heading">
        <h2 id="threads-board-heading">{BOARD_HEADING}</h2>

        {/* One region, mounted with the page and never unmounted, so the sentence that replaces its
            content is announced: the board reading and the board arriving are both status changes. */}
        <div className="status-region" role="status">
          {boardStatus === null ? null : <p>{boardStatus}</p>}
        </div>

        {readError === null ? null : <ErrorNotice error={readError} onRetry={reload} />}

        {threads === null || threads.length === 0 ? null : (
          <ul className="item-list">
            {threads.map(
              (thread: ThreadListItem): JSX.Element => (
                <li key={thread.id} className="item-list__item">
                  <p>
                    <Link to={threadPath(thread.id)}>{thread.title}</Link>
                  </p>
                  <p>
                    Started by <strong>{describeAuthor(thread.author_account_id)}</strong>
                    {", "}
                    <Timestamp value={thread.created_at} />
                    {", "}
                    {describePostCount(thread.posts.length)}
                  </p>
                </li>
              ),
            )}
          </ul>
        )}

        {threads !== null && threads.length === 0 ? (
          <EmptyState
            heading={EMPTY_BOARD_HEADING}
            explanation={EMPTY_BOARD_EXPLANATION}
            action={
              <button type="button" className="button button--secondary" onClick={focusCreateRegion}>
                {START_FIRST_THREAD_LABEL}
              </button>
            }
          />
        ) : null}
      </section>

      {isSelectionUnknown ? (
        <EmptyState
          heading={UNKNOWN_THREAD_HEADING}
          explanation={UNKNOWN_THREAD_EXPLANATION}
          action={<Link to="/threads">{BACK_TO_BOARD_LABEL}</Link>}
        />
      ) : null}

      {selectedThread === null ? null : (
        <section aria-labelledby="threads-open-heading">
          <h2 id="threads-open-heading">{selectedThread.title}</h2>
          <p>
            {"Started by "}
            <strong>{describeAuthor(selectedThread.author_account_id)}</strong>
            {", "}
            <Timestamp value={selectedThread.created_at} />
            {", "}
            {describePostCount(selectedThread.posts.length)}
          </p>

          {selectedThread.posts.length === 0 ? (
            // A third level, so the explanation reads as part of the open thread rather than as a
            // second section beside it.
            <EmptyState
              heading={EMPTY_POSTS_HEADING}
              explanation={EMPTY_POSTS_EXPLANATION}
              headingLevel={3}
            />
          ) : (
            // The list carries its own name because the section it sits in is named by the thread's
            // title, which does not say that what follows is its replies.
            <ul className="item-list" aria-label={REPLIES_LABEL}>
              {selectedThread.posts.map(
                (post: ThreadPost): JSX.Element => (
                  <li key={post.id} className="item-list__item">
                    {/* A reply is rendered as text and never as markup: every paragraph is what its
                        author typed, escaped by the renderer, and the only structure this page adds
                        is the paragraph break the author wrote. */}
                    {readPostParagraphs(post.body).map(
                      (paragraph: string, paragraphIndex: number): JSX.Element => (
                        <p key={`${post.id}-paragraph-${paragraphIndex}`}>{paragraph}</p>
                      ),
                    )}
                    <p>
                      Posted by <strong>{describeAuthor(post.author_account_id)}</strong>
                      {", "}
                      <Timestamp value={post.created_at} />
                    </p>
                  </li>
                ),
              )}
            </ul>
          )}

          <h3>{REPLY_HEADING}</h3>
          {/* Keyed by the thread it replies to, so switching threads starts a fresh form. Without
              the key React would keep this component's state across the switch and a reader would
              see the outcome of a write made on the thread they just left. The key does not change
              when the board is re-read, so the confirmation a successful reply leaves on screen
              survives the re-read that puts the reply in the list above. */}
          <ThreadReplyForm
            key={selectedThread.id}
            threadId={selectedThread.id}
            onCreated={handleReplyPosted}
          />
        </section>
      )}
    </main>
  );
}

// The default export is what app.tsx's route table imports; the named export is what a test or a
// sibling page imports. Both exist on purpose, as they do on every page in this folder.
export default Threads;
