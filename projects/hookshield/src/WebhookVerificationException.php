<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield;

/**
 * Thrown when an incoming webhook cannot be trusted. The reason is exposed as
 * a stable machine-readable code so it can be logged or mapped to responses.
 */
final class WebhookVerificationException extends \RuntimeException
{
    public const MISSING_HEADERS = 'missing_headers';
    public const INVALID_TIMESTAMP = 'invalid_timestamp';
    public const TIMESTAMP_TOO_OLD = 'timestamp_too_old';
    public const TIMESTAMP_IN_FUTURE = 'timestamp_in_future';
    public const NO_MATCHING_SIGNATURE = 'no_matching_signature';
    public const REPLAYED = 'replayed';

    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
