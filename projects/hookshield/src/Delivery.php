<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield;

use MirrorOrg\HookShield\Transport\Response;

/** The outcome of dispatching one webhook, including every attempt made. */
final class Delivery
{
    /** @param list<Response> $attempts */
    public function __construct(
        public readonly string $id,
        public readonly string $url,
        public readonly array $attempts,
    ) {
    }

    public function successful(): bool
    {
        return $this->lastResponse()?->successful() ?? false;
    }

    public function attemptCount(): int
    {
        return count($this->attempts);
    }

    public function lastResponse(): ?Response
    {
        return $this->attempts === [] ? null : $this->attempts[array_key_last($this->attempts)];
    }
}
