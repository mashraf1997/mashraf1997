<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield\Transport;

final class Response
{
    /** @param int|null $status null when the request failed before a response (DNS, TLS, timeout) */
    public function __construct(
        public readonly ?int $status,
        public readonly string $body = '',
        public readonly ?string $error = null,
        public readonly ?int $retryAfterSeconds = null,
    ) {
    }

    public function successful(): bool
    {
        return $this->status !== null && $this->status >= 200 && $this->status < 300;
    }
}
