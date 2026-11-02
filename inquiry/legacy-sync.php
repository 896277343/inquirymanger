<?php
// Run from cron as: php /path/to/inquiry/legacy-sync.php
// Requires LEGACY_INQUIRY_SYNC_URL, LEGACY_INQUIRY_SYNC_SECRET and LEGACY_INQUIRY_SYNC_FROM_ID.
// CLI additionally uses LEGACY_INQUIRY_DB_PATH when the application bootstrap is unavailable.
function legacy_sync_db_path() {
    return defined('DB_PATH') ? DB_PATH : getenv('LEGACY_INQUIRY_DB_PATH');
}

function legacy_sync_prefix() {
    $prefix = defined('DB_PREFIX') ? DB_PREFIX : 'wp';
    if (!preg_match('/^[A-Za-z0-9_]+$/', $prefix)) throw new Exception('Invalid database prefix');
    return $prefix;
}

function legacy_sync_db() {
    $path = legacy_sync_db_path();
    if (!$path || !is_file($path)) throw new Exception('Legacy database path is missing');
    $prefix = legacy_sync_prefix();
    $pdo = new PDO('sqlite:'.$path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA busy_timeout = 10000');
    $pdo->exec('CREATE TABLE IF NOT EXISTS '.$prefix.'_central_sync (
        inquiry_id INTEGER PRIMARY KEY,
        synced_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
    )');
    return $pdo;
}

function legacy_sync_one($id) {
    $url = getenv('LEGACY_INQUIRY_SYNC_URL');
    $secret = getenv('LEGACY_INQUIRY_SYNC_SECRET');
    $fromId = getenv('LEGACY_INQUIRY_SYNC_FROM_ID');
    if (!$url || !$secret || strlen($secret) < 32 || !is_numeric($fromId) || (int)$id <= (int)$fromId) return false;
    if (parse_url($url, PHP_URL_SCHEME) !== 'https') return false;

    try {
        $pdo = legacy_sync_db();
        $prefix = legacy_sync_prefix();
        $stmt = $pdo->prepare('SELECT * FROM '.$prefix.'_inquiry WHERE id=? AND type=?');
        $stmt->execute(array((int)$id, 'inquiry'));
        $record = $stmt->fetch();
        if (!$record) return false; // Never send trashed entries.
        $status = $pdo->prepare('SELECT synced_at FROM '.$prefix.'_central_sync WHERE inquiry_id=?');
        $status->execute(array((int)$id));
        $synced = $status->fetch();
        if ($synced && $synced['synced_at']) return true;

        $meta = array();
        $stmt = $pdo->prepare('SELECT `key`,`value` FROM '.$prefix.'_inquiry_meta WHERE inquiryid=?');
        $stmt->execute(array((int)$id));
        while ($item = $stmt->fetch()) $meta[$item['key']] = $item['value'];

        $payload = array(
            'externalId' => (string)$record['id'], 'type' => $record['type'],
            'site' => $record['from_company'], 'pageUrl' => $record['website'],
            'name' => $record['name'], 'email' => $record['email'],
            'company' => isset($meta['company']) ? $meta['company'] : $record['company'],
            'country' => $record['country'], 'phone' => $record['phone'],
            'product' => isset($meta['products']) ? $meta['products'] : '',
            'message' => $record['content'], 'submittedAt' => $record['time'],
            'legacy' => array('title' => $record['title'], 'ip' => $record['ip'], 'address' => $record['address'], 'meta' => $meta)
        );
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($body === false) throw new Exception('JSON encoding failed');
        $timestamp = (string)time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$body, $secret);
        if (!function_exists('curl_init')) throw new Exception('PHP cURL extension is missing');
        $curl = curl_init($url);
        curl_setopt_array($curl, array(
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_TIMEOUT => 5,
            CURLOPT_HTTPHEADER => array('Content-Type: application/json', 'X-Inquiry-Timestamp: '.$timestamp, 'X-Inquiry-Signature: '.$signature)
        ));
        $result = curl_exec($curl);
        $http = curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $curlError = curl_error($curl);
        curl_close($curl);
        $decoded = is_string($result) ? json_decode($result, true) : null;
        if ($http < 200 || $http >= 300 || !is_array($decoded) || empty($decoded['ok'])) {
            throw new Exception($curlError ? $curlError : 'Central API returned HTTP '.$http);
        }
        $stmt = $pdo->prepare('INSERT OR REPLACE INTO '.$prefix.'_central_sync (inquiry_id,synced_at,attempts,last_error) VALUES (?,datetime(\'now\',\'localtime\'),COALESCE((SELECT attempts FROM '.$prefix.'_central_sync WHERE inquiry_id=?),0)+1,NULL)');
        $stmt->execute(array((int)$id, (int)$id));
        return true;
    } catch (Exception $error) {
        if (isset($pdo)) {
            $prefix = legacy_sync_prefix();
            $stmt = $pdo->prepare('INSERT OR REPLACE INTO '.$prefix.'_central_sync (inquiry_id,synced_at,attempts,last_error) VALUES (?,NULL,COALESCE((SELECT attempts FROM '.$prefix.'_central_sync WHERE inquiry_id=?),0)+1,?)');
            $stmt->execute(array((int)$id, (int)$id, substr($error->getMessage(), 0, 500)));
        }
        error_log('Legacy inquiry sync #'.(int)$id.': '.$error->getMessage());
        return false;
    }
}

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === realpath(__FILE__)) {
    if (PHP_SAPI !== 'cli') exit(1);
    if (!getenv('LEGACY_INQUIRY_SYNC_URL') || !getenv('LEGACY_INQUIRY_SYNC_SECRET') || !is_numeric(getenv('LEGACY_INQUIRY_SYNC_FROM_ID'))) exit(2);
    $pdo = legacy_sync_db();
    $prefix = legacy_sync_prefix();
    $stmt = $pdo->prepare('SELECT i.id FROM '.$prefix.'_inquiry i LEFT JOIN '.$prefix.'_central_sync s ON s.inquiry_id=i.id WHERE i.id>? AND i.type=? AND s.synced_at IS NULL ORDER BY COALESCE(s.attempts,0) ASC,i.id ASC LIMIT 50');
    $stmt->execute(array((int)getenv('LEGACY_INQUIRY_SYNC_FROM_ID'), 'inquiry'));
    $failed = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) if (!legacy_sync_one($id)) $failed++;
    echo 'Sync batch complete; failures: '.$failed.PHP_EOL;
    exit($failed ? 1 : 0);
}
