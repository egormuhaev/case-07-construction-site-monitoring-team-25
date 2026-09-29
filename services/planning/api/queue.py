from __future__ import annotations

import asyncio

from planning.settings import Settings

from .runner import ModelRegistry, run_job
from .store import JobStore


class JobQueue:
    def __init__(self, store: JobStore, settings: Settings, registry: ModelRegistry) -> None:
        self.store = store
        self.settings = settings
        self.registry = registry
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=settings.queue_limit)
        self._workers: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        for index in range(self.settings.max_concurrent_jobs):
            self._workers.append(asyncio.create_task(self._worker(index)))
        await self.restore()

    async def stop(self) -> None:
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    def submit(self, job_id: str) -> None:
        self.queue.put_nowait(job_id)

    def is_full(self) -> bool:
        return self.queue.full()

    async def restore(self) -> None:
        for job_id in self.store.list_active_job_ids():
            record = self.store.get_job(job_id)
            if record and record.get("status") in {"ACCEPTED", "PROCESSING"}:
                try:
                    self.submit(job_id)
                except asyncio.QueueFull:
                    pass

    async def _worker(self, _index: int) -> None:
        while True:
            job_id = await self.queue.get()
            try:
                await asyncio.to_thread(run_job, job_id, self.store, self.settings, self.registry)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            finally:
                self.queue.task_done()
