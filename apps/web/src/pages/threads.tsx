/**
 * The `/threads` page: the public discussion board and the thread a reader has open.
 *
 * The board is the contributor-facing surface of the product — the place a standard, a proposal, a
 * fixture set or a piece of evidence is discussed — so it is open to any demo account. Starting a
 * thread and posting a reply both accept whichever synthetic account the header's switcher has
 * selected, which is why this page renders no role gate: a `403` cannot occur on either write, and
 * a sentence explaining one would describe a refusal the contract does not have. The service's
 * refusals are the `401` of a missing or unresolvable account, a `400` on the field, the reply's
 * `404` for a thread that is gone and the `429` write rate limit — each explained by the form
 * components, which own their own field, their own explanation and their own polite announcement.
 *
 * Five decisions shape this file.
 *
 * **The address is the selection and the page.** Which thread is open lives in the `id` query
 * parameter, and which page of the board is on screen lives in the `page` parameter, and in nothing
 * else: no context provider, no shared state module, no storage. A thread is therefore a link a
 * contributor can paste, the back button steps through the threads that were opened and the pages
 * that were read, and a selection the page of the board cannot resolve renders an explanation with a
 * way back to the board rather than an empty panel.
 *
 * **The board's page is read, one bounded page at a time.** `GET /threads` answers one page of a board
 * it counts in full, so the address's page is forwarded to the read and the two counts the read states
 * are kept apart: the rows this page holds, and the size of the whole board. The paging row below the
 * board is what makes an older page reachable, and a page past the last one is the ordinary empty page
 * the route documents rather than a failure — it renders an explanation naming the board's own size
 * and a link back to the page that holds its rows. An address whose page the contract cannot express
 * sends no request at all, because the client would have to replace the value silently, and renders
 * the `400` the API would have answered it with in the same notice the API's own refusals use.
 *
 * **One read, and re-read rather than patched.** `../api-client` is the only module that calls the
 * API, and this page makes exactly one kind of call through it: `listThreads`. After a thread is
 * started or a reply is posted, the board is read again instead of being merged from the response,
 * so what a reader sees is what the service returned, in the service's own order. Both the board
 * and a thread's posts are ordered by the service, and a row this page appended locally would be
 * this page's guess at where that row belongs.
 *
 * **A refresh keeps the rows that are already on screen.** Re-reading never blanks the board: the
 * loading state belongs to the first read of a page, and a later read that fails leaves the board
 * readable with the failure explained beside it. A read is also marked in flight the moment it is
 * asked for, because a selection written a moment earlier must not be judged — and so announced as
 * unknown — against the board it is about to replace. Rows hold their place for the page they were
 * returned for and no other: a reading of a different page is never rendered against the page the
 * address now asks for, so a page change shows the board loading rather than the previous page's
 * rows under the new page's address.
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
import { ApiClientError, listThreads } from "../api-client";
import type { ThreadBoardRead, ThreadListItem } from "../api-client";
import {
  ACCEPTED_PAGE_VALUES,
  PAGE_PARAM,
  collectionPageHref,
  lastPageNumber,
  readRequestedPage,
} from "../collection-paging";
import type { RequestedPage } from "../collection-paging";
import { CollectionPager } from "../components/collection-pager";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { ThreadCreateForm, ThreadReplyForm } from "../components/thread-reply-form";
import { findDemoAccount } from "../data/demo-accounts";
import { Timestamp, readString } from "../payload-reading";

/** The route this page owns, which every link that selects a thread or a page is built from. */
const THREADS_PATH = "/threads";

/**
 * The query parameter that names the open thread. It is this page's only selection state — the page
 * of the board the selection is read from travels in the `page` parameter the shared paging contract
 * spells — and it is spelled here rather than shared because no other module reads or writes it.
 */
const THREAD_ID_PARAM = "id";

/**
 * The page an address that asks for no usable page is compared against. It is never sent: such an
 * address has no request, and the refusal notice is what the board renders for it.
 */
const FIRST_PAGE = 1;

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

/** The accessible name of the paging row, and the collection its own reasons name. */
const PAGER_LABEL = "Board pages";
const PAGER_COLLECTION_NAME = "board";

/**
 * The refusal an address whose page the board read cannot express is explained with.
 *
 * It is the same `400` the API would have answered such a request with, rendered through the same
 * component, so a reader meets one shape whichever side refused: what happened, what the board read
 * accepts in place of the value, and the link that resolves the address. The value itself is quoted in
 * the notice's detail, where it is rendered as text rather than echoed into a message.
 */
const REFUSAL_MESSAGE =
  "The address carries a page value the board read cannot express, so no request was sent for it.";
const REFUSED_PAGE_PARAMETER_NOTE = `The board is read one page of ${String(COLLECTION_PAGE_SIZE)} threads at a time, and the page parameter names which of those pages to read.`;
const WITHOUT_PAGE_PARAMETER_LABEL = "Read the board without the page parameter";

/**
 * The page past the last one: the state the route's own documentation calls this page's, stated with
 * the action that returns a reader to the rows the board does hold.
 */
const LAST_PAGE_OF_THE_BOARD_LABEL = "Go to the last page of the board";

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
 * The address that opens one thread from the page of the board the reader is looking at.
 *
 * The selection is rewritten and every other parameter of the board's own address is carried through
 * untouched, so a thread opened from an older page keeps that page: the row the reader clicked is on
 * it, and an address that dropped the page would report that thread as one the page it was clicked
 * from does not carry. The identifier is left to the serialisation, which encodes it.
 */
function threadPath(params: URLSearchParams, threadId: string): string {
  const next = new URLSearchParams(params);
  next.set(THREAD_ID_PARAM, threadId);
  return `${THREADS_PATH}?${next.toString()}`;
}

/** A page value the contract cannot express, with the value the address wrote. */
type PageRefusal = Extract<RequestedPage, { readonly kind: "refused" }>;

/**
 * The notice an address whose page the contract refuses is explained with.
 *
 * It is the same `400` the API would have answered such a request with, rendered through the same
 * component, and the link drops the parameter at fault and keeps every other one — the smallest change
 * that makes the address answerable again, so a reader who mistyped a page number keeps the thread they
 * had open. The value is quoted as text and no request is ever sent for it: the client would have to
 * replace it silently, and a page that showed one page while its address asked for another would be a
 * page whose own address is not what it shows.
 */
function renderRefusalNotice(refusal: PageRefusal, validHref: string): JSX.Element {
  return (
    <ErrorNotice
      error={new ApiClientError(400, "validation_error", REFUSAL_MESSAGE)}
      detail={
        <>
          <p>
            {`The address carries "${refusal.value}" as the page parameter, and the board read accepts ${ACCEPTED_PAGE_VALUES}.`}
          </p>
          <p>{REFUSED_PAGE_PARAMETER_NOTE}</p>
          <p>
            <Link to={validHref}>{WITHOUT_PAGE_PARAMETER_LABEL}</Link>
          </p>
        </>
      }
    />
  );
}

/**
 * The address with the page parameter removed, which is how a refused page value is resolved.
 *
 * A refused value is dropped rather than replaced with `1`: the reader wrote neither, and the shortest
 * address that means the first page is the one without the parameter at all.
 */
function hrefWithoutPageParameter(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete(PAGE_PARAM);
  const serialized = next.toString();
  return serialized === "" ? THREADS_PATH : `${THREADS_PATH}?${serialized}`;
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
 * A stored body keeps the blank lines the reply field submitted, and a blank line is the only
 * paragraph break a reply can carry, so splitting on one — a line break, then any run of spaces, tabs
 * or further line breaks, then another line break — and rendering one paragraph per non-empty piece
 * is what turns that blank line into a real paragraph carrying the product's paragraph spacing. Each
 * paragraph then carries the stylesheet's `.stored-text` utility, so a single line break inside one
 * reaches the reader as the author wrote it rather than as the one space a collapsed run of
 * whitespace becomes. That is the whole of the formatting this page adds: each piece is still text,
 * escaped by the renderer, and never markup.
 *
 * A body with no blank line in it is a single piece, so the split leaves it whole, and a body whose
 * pieces are all blank still renders one paragraph rather than disappearing, so a reply is never
 * invisible.
 */
function readPostParagraphs(body: unknown): readonly string[] {
  const paragraphs = readString(body)
    .split(/\n\s*\n/)
    .map((paragraph: string): string => paragraph.trim())
    .filter((paragraph: string): boolean => paragraph !== "");
  return paragraphs.length === 0 ? [""] : paragraphs;
}

/**
 * One settled reading of the board: the page the address asked for, the rows and the board's own count
 * the service answered with, and the page the service stated those rows are from.
 *
 * The two counts are held apart on purpose, because they are two facts: `items.length` is how many rows
 * this page holds, and `total` is how many threads the whole board holds. A sentence that stated one as
 * the other would tell a reader they had seen everything while rows remained.
 */
interface BoardReading {
  /** The page the address asked for, which is the page this reading is kept for. */
  readonly requestedPage: number;
  /** The page's threads, in the service's own order. */
  readonly items: readonly ThreadListItem[];
  /** The number of threads the whole board holds, as the read stated it. */
  readonly total: number;
  /** The page the service stated these rows are from, which is the page a sentence names. */
  readonly answeredPage: number;
}

/**
 * The board as this page holds it: the page the state answers, the reading that page has, whether a read
 * for it is in flight, and the failure the last read of it raised.
 *
 * One object rather than four pieces of state, because the four are read together and a reading of one
 * page must never be rendered as though it answered another: the page is the key, and the whole state
 * moves with it.
 */
interface BoardState {
  /** The address page this state answers. */
  readonly page: number;
  /** The reading this page has, or `null` while its first read has yet to settle. */
  readonly reading: BoardReading | null;
  /** Whether a read for this page is in flight. */
  readonly isLoading: boolean;
  /** The failure the last read of this page raised, or `null`. */
  readonly failure: unknown;
}

/** How many threads a count is, in the reader's own words, singular or plural. */
function describeThreadCount(count: number): string {
  return count === 1 ? "one thread" : `${count} threads`;
}

/**
 * How many rows the page holds, as a bare count rather than as a count of something.
 *
 * The sentence that states it names the board's own noun once, after "of its", so the row count belongs
 * there as a number alone — "holding 20 of its 28 threads". A count of one is spelled rather than
 * written as a digit, as every count in this file is, so a short page never reads "1 of its 28 threads".
 */
function describeRowCount(count: number): string {
  return count === 1 ? "one" : String(count);
}

/** How many pages a count of pages is, in the reader's own words, singular or plural. */
function describePageCount(count: number): string {
  return count === 1 ? "one page" : `${count} pages`;
}

/**
 * What the board's live region says once a read has settled. The two counts are the facts a reader
 * cannot see from the list itself, and they are not the same fact: how many rows this page holds, and
 * how many threads the whole board holds.
 *
 * There are four settled sentences, and which one is said depends on whether the board's own size is
 * known to be on screen. The whole board is on screen exactly when the page carries every thread the
 * read counted, so the board's size is stated as the board's size then and only then. A page that
 * holds rows of a longer board names the page and both counts; a page past the end has no rows to show
 * and says where the board's rows are instead. A page that came back full is never described as the
 * board, which is what a sentence stating a page's row count as the board's size would do.
 */
function describeLoadedBoard(page: number, count: number, total: number): string {
  if (total === 0) {
    return "The board is loaded and holds no thread yet.";
  }
  if (count === total) {
    return `The board is loaded with ${describeThreadCount(count)} on it.`;
  }
  if (count === 0) {
    return total === 1
      ? `Page ${String(page)} of the board is loaded, and its ${describeThreadCount(total)} is before it.`
      : `Page ${String(page)} of the board is loaded, and its ${describeThreadCount(total)} are all before it.`;
  }
  return `Page ${String(page)} of the board is loaded, holding ${describeRowCount(count)} of its ${describeThreadCount(total)}.`;
}

/**
 * The sentence the board's live region carries, or `null` when it should carry none.
 *
 * It is `null` in three situations, and each of them matters. A refused page carries none: the notice
 * beneath the region states the refusal inside its own live region, so a sentence here would put the
 * same words on the page twice and have a screen-reader user hear them twice. That branch must stay
 * ahead of the loading sentence as well, because no request is sent for a refused address and the
 * loading sentence would name a read that never happened. While a later read is in flight over rows
 * that are already on screen there is no state worth announcing, because nothing a reader can see is
 * about to change. And when a read failed there is nothing to announce here either: the error notice
 * beside this region is the explanation, and a second, vaguer sentence from this region would be the
 * duplicate a screen-reader user hears first.
 */
function describeBoardStatus(
  reading: BoardReading | null,
  isLoading: boolean,
  failure: unknown,
  refusal: PageRefusal | null,
): string | null {
  if (refusal !== null) {
    return null;
  }
  if (failure !== null) {
    return null;
  }
  if (reading === null) {
    return LOADING_MESSAGE;
  }
  return isLoading
    ? null
    : describeLoadedBoard(reading.answeredPage, reading.items.length, reading.total);
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

  // The address, read once per render and reduced to primitives, so the effect below re-runs when the
  // page it asks for changes rather than whenever a fresh `URLSearchParams` was allocated for the same
  // address.
  const requested = readRequestedPage(searchParams);
  const refusal: PageRefusal | null = requested.kind === "refused" ? requested : null;
  const page = requested.kind === "requested" ? requested.page : FIRST_PAGE;
  const refusalKey = refusal === null ? "" : refusal.value;

  // The board as this page holds it, keyed by the page it answers, and the counter that asks for
  // another read of it. A state whose page is not the one the address asks for is not rendered at all,
  // which is what keeps the previous page's rows from appearing under the new page's address.
  const [read, setRead] = useState<BoardState>((): BoardState => ({
    page,
    reading: null,
    isLoading: true,
    failure: null,
  }));
  const [readCount, setReadCount] = useState<number>(0);

  // The create region, focused by the empty board's action. It is the region rather than the field
  // inside it: the field belongs to a component this page does not own, and the region is what the
  // action's own label names.
  const createRegionRef = useRef<HTMLElement | null>(null);

  // The reading the address's page has, or the in-flight state that stands in for it: a reading of
  // another page answers a question the reader is no longer asking.
  const current: BoardState =
    read.page === page ? read : { page, reading: null, isLoading: true, failure: null };

  // The rows on screen, and the whole of what this page renders from. A refused page renders none of
  // them: the notice below the board's status region is what the page shows instead.
  const rows: readonly ThreadListItem[] | null =
    refusal !== null || current.reading === null ? null : current.reading.items;

  const total = current.reading === null ? 0 : current.reading.total;
  const lastPage = lastPageNumber(total);
  const isBoardEmpty = rows !== null && rows.length === 0 && total === 0;
  const isPastLastPage = rows !== null && rows.length === 0 && total > 0;

  const selectedId = readSelectedThreadId(searchParams);

  const selectedThread: ThreadListItem | null =
    rows === null || selectedId === null
      ? null
      : (rows.find((thread: ThreadListItem): boolean => thread.id === selectedId) ?? null);

  // A selection that resolves to nothing is only reportable once a read has settled over rows the
  // page actually holds. While a read is in flight the selection is a question still being
  // answered, after a failed read the board on screen is not the board the address was written
  // against, and while a refused page stands there are no rows to resolve it against — so none of the
  // three claims the thread is missing.
  const isSelectionUnknown =
    refusal === null &&
    current.failure === null &&
    !current.isLoading &&
    rows !== null &&
    selectedId !== null &&
    selectedThread === null;

  const boardStatus = describeBoardStatus(
    refusal === null ? current.reading : null,
    current.isLoading,
    current.failure,
    refusal,
  );

  /** The address of one page of this board, carrying whatever else the board's address holds. */
  const pageHref = useCallback(
    (targetPage: number): string => collectionPageHref(THREADS_PATH, searchParams, targetPage),
    [searchParams],
  );

  /**
   * Read the board again.
   *
   * The read is marked in flight here rather than only in the effect, because this is the moment a
   * caller knows the board on screen is stale: a thread started a moment ago is already selected in
   * the address, and it must not be reported as missing while the effect that will fetch it has yet
   * to run.
   */
  const reload = useCallback((): void => {
    setRead((previous: BoardState): BoardState => ({ ...previous, isLoading: true }));
    setReadCount((previous: number): number => previous + 1);
  }, []);

  /**
   * Open one thread on the board's newest page, which is where a thread that was just started is.
   *
   * The page parameter is dropped rather than written as `1` for the same reason the pager's
   * first-page link drops it: the shortest address that means the newest page. A reader who started a
   * thread from an older page therefore leaves that page, which is what makes the new row — the
   * board's newest — the one on screen beside it.
   */
  const openNewestBoardRow = useCallback(
    (threadId: string): void => {
      const next = new URLSearchParams(searchParams);
      next.delete(PAGE_PARAM);
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
   * A refused page has no request to send, so the effect sends none and the notice stands in its place.
   * The cancelled flag is what keeps a reader from being shown a board twice: the read is asked for
   * when the page or the reload counter turns, and a response that arrives after a newer one has been
   * requested is discarded rather than rendered.
   */
  useEffect((): (() => void) | void => {
    if (refusal !== null) {
      return;
    }

    let cancelled = false;

    // A read of the page the address asks for is in flight, and the rows already read for that same
    // page stay on screen while it is: only a read of a different page starts from nothing, so a
    // refresh never blanks the board and a page change never shows the page just left.
    setRead((previous: BoardState): BoardState => ({
      page,
      reading: previous.page === page ? previous.reading : null,
      isLoading: true,
      failure: null,
    }));

    listThreads(page).then(
      (board: ThreadBoardRead): void => {
        if (cancelled) {
          return;
        }
        setRead({
          page,
          reading: {
            requestedPage: page,
            items: board.items,
            total: board.total,
            answeredPage: board.page,
          },
          isLoading: false,
          failure: null,
        });
      },
      (failure: unknown): void => {
        if (cancelled) {
          return;
        }
        setRead((previous: BoardState): BoardState => ({
          page,
          reading: previous.page === page ? previous.reading : null,
          isLoading: false,
          failure,
        }));
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [page, refusalKey, readCount]);

  /**
   * A thread was started: open it on the board's newest page, then read the board again.
   *
   * Both halves are needed. The selection is what makes the new thread the one shown below, and the
   * read is what places it among the others in the order the service keeps rather than at a
   * position this page chose.
   */
  const handleThreadCreated = useCallback(
    (thread: Thread): void => {
      openNewestBoardRow(thread.id);
      reload();
    },
    [openNewestBoardRow, reload],
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
            content is announced: the board reading and the board arriving are both status changes. A
            refused page carries no sentence here, because the notice below states the refusal. */}
        <div className="status-region" role="status">
          {boardStatus === null ? null : <p>{boardStatus}</p>}
        </div>

        {/* A page the contract refuses is explained rather than sent, so the notice stands where the
            page's own outcome would: there are no rows to render, and no request was made for any. */}
        {refusal === null ? null : renderRefusalNotice(refusal, hrefWithoutPageParameter(searchParams))}

        {refusal !== null || current.failure === null ? null : (
          <ErrorNotice error={current.failure} onRetry={reload} />
        )}

        {rows === null || rows.length === 0 ? null : (
          <ul className="item-list">
            {rows.map(
              (thread: ThreadListItem): JSX.Element => (
                <li key={thread.id} className="item-list__item">
                  <p>
                    {/* The address carries the page the reader is on as well as the thread, so the
                        selection they open is resolved against the rows it was clicked from. */}
                    <Link to={threadPath(searchParams, thread.id)}>{thread.title}</Link>
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

        {/* The two empty states the board has, and they are not the same state. A board that holds
            nothing at all is explained with the action that leaves it; a page past the board's last
            one holds no rows either, but the board does, so that state names the board's own size and
            where its rows stop and offers the page they are on. */}
        {isBoardEmpty ? (
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

        {isPastLastPage ? (
          <EmptyState
            heading={`Nothing on page ${String(page)}`}
            explanation={`The board holds ${describeThreadCount(total)} on ${describePageCount(lastPage)}; page ${String(page)} is past the last page.`}
            action={
              <Link to={pageHref(lastPage)}>{LAST_PAGE_OF_THE_BOARD_LABEL}</Link>
            }
          />
        ) : null}

        {/* The paging row belongs to a board that has answered: without a settled reading there is no
            size to page over, and the notice above is what a reader is owed instead. It is rendered
            for a page past the end too, because the page that holds the rows is exactly where its
            controls go. */}
        {refusal !== null || current.reading === null ? null : (
          <CollectionPager
            page={current.reading.requestedPage}
            lastPage={lastPage}
            label={PAGER_LABEL}
            collectionName={PAGER_COLLECTION_NAME}
            hrefFor={pageHref}
          />
        )}
      </section>

      {isSelectionUnknown ? (
        <EmptyState
          heading={UNKNOWN_THREAD_HEADING}
          explanation={UNKNOWN_THREAD_EXPLANATION}
          action={<Link to={THREADS_PATH}>{BACK_TO_BOARD_LABEL}</Link>}
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
                        <p
                          key={`${post.id}-paragraph-${paragraphIndex}`}
                          className="stored-text"
                        >
                          {paragraph}
                        </p>
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
