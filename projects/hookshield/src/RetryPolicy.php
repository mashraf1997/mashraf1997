<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield;

/** Exponential backoff with full jitter, capped at a maximum delay. */
final class RetryPolicy
{
    /** @var \Closure(int, int): int */
    private \Closure $random;

    /**
     * @param (\Closure(int, int): int)|null $random random_int-compatible source (injectable for tests)
     */
    public function __construct(
        public readonly int $maxAttempts = 5,
        public readonly int $baseDelayMs = 500,
        public readonly int $maxDelayMs = 30_000,
        ?\Closure $random = null,
    ) {
        if ($maxAttempts < 1) {
            throw new \InvalidArgumentException('maxAttempts must be at least 1.');
        }
        $this->random = $random ?? static fn (int $min, int $max): int => random_int($min, $max);
    }

    /** Delay before retry number $attempt (1 = first retry), in milliseconds. */
    public function delayMs(int $attempt): int
    {
        $ceiling = (int) min($this->maxDelayMs, $this->baseDelayMs * (2 ** max(0, $attempt - 1)));
        return ($this->random)(0, $ceiling);
    }

    /** Network failures, timeouts, rate limits and server errors are retryable. */
    public function isRetryable(?int $status): bool
    {
        return $status === null || $status === 408 || $status === 425 || $status === 429 || $status >= 500;
    }
}
