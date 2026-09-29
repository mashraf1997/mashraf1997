<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield;

/** Remembers message IDs so a captured webhook cannot be replayed. */
interface NonceStore
{
    /**
     * Records $id for $ttlSeconds. Returns false when the id was already
     * recorded (i.e. this delivery is a replay). Must be atomic.
     */
    public function add(string $id, int $ttlSeconds): bool;
}
