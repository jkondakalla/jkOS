// offline/ — PapyrOS's offline media cache (Wave 7.1) + offline write queue
// (Wave 7.2). One place the rest of the app (and the 7.3 SW media router)
// import from.
//
// Public surface:
//   Storage identity (also used by public/sw.js in 7.3):
//     MEDIA_CACHE, OFFLINE_DB, OFFLINE_DB_VERSION, BOOKS_STORE
//     streamKey / coverKey / detailKey  — a book's Cache API keys
//     OfflineBookRecord                 — the IndexedDB bookkeeping row
//   Bookkeeping (IndexedDB):
//     offlineSupported, getAllOfflineBooks, getOfflineBook, putOfflineBook, deleteOfflineBook
//   Pipeline + reactive store:
//     downloadBook, cancelDownload, removeDownload, estimateStorage
//     useOfflineStatus(bookId), useOfflineLibrary()
//     OfflineStatus / OfflinePhase / StorageEstimate types
//   Write queue (7.2 — @jkos/player/services generic queue, wired by ../api.ts):
//     WRITE_QUEUE_DB                    — the queue's own IndexedDB database name
//     getWriteQueue()                   — the live queue (pending()/size()/flush())
//     initOfflineWrites / DirectWriteApi / QueuedWriteApi — the ../api.ts seam
//   Components:
//     OfflineBadge, OfflineButton, OfflineSettings

export {
  MEDIA_CACHE, OFFLINE_DB, OFFLINE_DB_VERSION, BOOKS_STORE,
  streamKey, coverKey, detailKey,
  type OfflineBookRecord,
} from './constants';

export {
  offlineSupported,
  getAllOfflineBooks, getOfflineBook, putOfflineBook, deleteOfflineBook,
} from './db';

export {
  downloadBook, cancelDownload, removeDownload, estimateStorage,
  useOfflineStatus, useOfflineLibrary,
  type OfflineStatus, type OfflinePhase, type StorageEstimate,
} from './store';

export { default as OfflineBadge } from './OfflineBadge';
export { default as OfflineButton } from './OfflineButton';
export { default as OfflineSettings } from './OfflineSettings';

// 7.2 — the offline write queue seam. ../api.ts calls initOfflineWrites() with its
// direct authFetch implementations and re-exports the wrapped write functions;
// getWriteQueue() exposes the live queue (pending()/size()/flush()) for any later
// sync-status surface. The generic machinery is @jkos/player/services.
export {
  WRITE_QUEUE_DB, initOfflineWrites, getWriteQueue,
  type DirectWriteApi, type QueuedWriteApi,
} from './writes';
