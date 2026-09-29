<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield\Transport;

interface Transport
{
    /** @param array<string, string> $headers */
    public function post(string $url, array $headers, string $body): Response;
}
