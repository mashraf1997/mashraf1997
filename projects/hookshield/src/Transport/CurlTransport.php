<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield\Transport;

final class CurlTransport implements Transport
{
    public function __construct(
        private readonly int $timeoutSeconds = 10,
        private readonly string $userAgent = 'HookShield/1.0',
    ) {
    }

    public function post(string $url, array $headers, string $body): Response
    {
        $retryAfter = null;
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = "{$name}: {$value}";
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => min(5, $this->timeoutSeconds),
            CURLOPT_FOLLOWLOCATION => false, // redirects could leak signed payloads elsewhere
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => $this->userAgent,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$retryAfter): int {
                if (preg_match('/^retry-after:\s*(\d+)\s*$/i', $line, $m)) {
                    $retryAfter = (int) $m[1];
                }
                return strlen($line);
            },
        ]);
        $responseBody = curl_exec($ch);
        if ($responseBody === false) {
            $error = curl_error($ch);
            curl_close($ch);
            return new Response(null, '', $error);
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return new Response($status, (string) $responseBody, null, $retryAfter);
    }
}
