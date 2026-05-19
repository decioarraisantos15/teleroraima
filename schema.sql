-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  NEXUS NOC — MySQL Schema v2.0                               ║
-- ║  Network Equipment Monitoring System                         ║
-- ║                                                              ║
-- ║  Execute:  mysql -u root -p < schema.sql                     ║
-- ╚═══════════════════════════════════════════════════════════════╝

CREATE DATABASE IF NOT EXISTS nexus_noc
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nexus_noc;

-- ─────────────────────────────────────────────────────────────
-- Usuário MySQL da aplicação
-- ─────────────────────────────────────────────────────────────
CREATE USER IF NOT EXISTS 'noc_user'@'localhost' IDENTIFIED BY 'NocPass2024!';
GRANT ALL PRIVILEGES ON nexus_noc.* TO 'noc_user'@'localhost';
FLUSH PRIVILEGES;

-- ─────────────────────────────────────────────────────────────
-- TABELA: users  (autenticação — login admin / usuário)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)   NOT NULL                        COMMENT 'Login único',
  password_hash VARCHAR(255)  NOT NULL                        COMMENT 'bcrypt hash',
  full_name     VARCHAR(100)      NULL                        COMMENT 'Nome completo',
  role          ENUM('admin','user') NOT NULL DEFAULT 'user'  COMMENT 'admin = acesso total | user = somente leitura',
  active        TINYINT(1)    NOT NULL DEFAULT 1              COMMENT '0 = conta desativada',
  last_login    DATETIME          NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username),
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Usuários do sistema (admin e visualizadores)';

-- ─────────────────────────────────────────────────────────────
-- TABELA: devices
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id            INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100)      NOT NULL,
  ip            VARCHAR(45)       NOT NULL,
  type          VARCHAR(60)       NOT NULL,
  vendor        VARCHAR(60)       NOT NULL DEFAULT 'Outro',
  location      VARCHAR(150)          NULL,
  contact       VARCHAR(150)          NULL,
  description   VARCHAR(255)          NULL,
  vlans         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status        ENUM('online','offline','warn') NOT NULL DEFAULT 'offline',
  latency_ms    SMALLINT UNSIGNED     NULL,
  uptime_start  DATETIME              NULL,
  cpu_pct       TINYINT UNSIGNED      NULL,
  mem_pct       TINYINT UNSIGNED      NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE  KEY uq_ip (ip),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
-- TABELA: snmp_configs
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snmp_configs (
  id              INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  device_id       INT UNSIGNED      NOT NULL,
  community       VARCHAR(100)      NOT NULL,
  port            SMALLINT UNSIGNED NOT NULL DEFAULT 161,
  trap_community  VARCHAR(100)          NULL,
  trap_target_ip  VARCHAR(45)           NULL,
  poll_interval   SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  ros_version     TINYINT UNSIGNED  NOT NULL DEFAULT 7,
  snmp_enabled    TINYINT(1)        NOT NULL DEFAULT 1,
  traps_enabled   TINYINT(1)        NOT NULL DEFAULT 0,
  acl_enabled     TINYINT(1)        NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE  KEY uq_device (device_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
-- TABELA: ping_results
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ping_results (
  id           BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  device_id    INT UNSIGNED      NOT NULL,
  status       ENUM('online','offline','warn') NOT NULL,
  latency_ms   SMALLINT UNSIGNED     NULL,
  packet_loss  TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  probed_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_device_time (device_id, probed_at),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
-- TABELA: snmp_polls
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snmp_polls (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  device_id   INT UNSIGNED     NOT NULL,
  oid_name    VARCHAR(80)      NOT NULL,
  oid         VARCHAR(120)     NOT NULL,
  value_text  VARCHAR(255)     NOT NULL,
  unit        VARCHAR(20)          NULL,
  polled_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_device_time (device_id, polled_at),
  INDEX idx_oid_name    (oid_name),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
-- TABELA: alerts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  device_id      INT UNSIGNED      NULL,
  severity       ENUM('info','warn','crit') NOT NULL DEFAULT 'info',
  title          VARCHAR(200)  NOT NULL,
  detail         VARCHAR(500)      NULL,
  acknowledged   TINYINT(1)    NOT NULL DEFAULT 0,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_sev     (severity),
  INDEX idx_created (created_at),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
-- TABELA: speed_tests
-- Histórico de testes de velocidade de internet (download/upload/ping)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS speed_tests (
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  download_mbps DECIMAL(10,2)         NULL  COMMENT 'Velocidade de download em Mbps',
  upload_mbps   DECIMAL(10,2)         NULL  COMMENT 'Velocidade de upload em Mbps',
  latency_ms    SMALLINT UNSIGNED     NULL  COMMENT 'Latência até servidor de teste (ms)',
  jitter_ms     DECIMAL(6,2)          NULL  COMMENT 'Variação de latência (ms)',
  server_host   VARCHAR(100)          NULL  COMMENT 'Servidor de teste utilizado',
  status        ENUM('ok','error','running') NOT NULL DEFAULT 'ok',
  error_msg     VARCHAR(255)          NULL,
  tested_at     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tested_at (tested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Histórico de testes de velocidade de internet';

-- ─────────────────────────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_device_summary AS
SELECT
  d.id, d.name, d.ip, d.type, d.vendor,
  d.location, d.contact, d.description, d.vlans,
  d.status, d.latency_ms, d.cpu_pct, d.mem_pct, d.uptime_start,
  CASE WHEN d.uptime_start IS NOT NULL AND d.status <> 'offline'
    THEN TIMESTAMPDIFF(SECOND, d.uptime_start, NOW()) ELSE NULL
  END AS uptime_seconds,
  IF(s.id IS NOT NULL, 1, 0) AS has_snmp,
  s.community, s.port AS snmp_port, s.poll_interval, s.ros_version,
  d.created_at, d.updated_at
FROM devices d
LEFT JOIN snmp_configs s ON s.device_id = d.id;

CREATE OR REPLACE VIEW v_last_ping AS
SELECT pr.* FROM ping_results pr
INNER JOIN (
  SELECT device_id, MAX(probed_at) AS last_probe
  FROM ping_results GROUP BY device_id
) lp ON pr.device_id = lp.device_id AND pr.probed_at = lp.last_probe;

CREATE OR REPLACE VIEW v_alerts_open AS
SELECT a.*, d.name AS device_name, d.ip AS device_ip
FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
WHERE a.acknowledged = 0
ORDER BY a.created_at DESC;

CREATE OR REPLACE VIEW v_dashboard_kpis AS
SELECT
  COUNT(*)                                              AS total_devices,
  SUM(status = 'online')                                AS online,
  SUM(status = 'warn')                                  AS warn,
  SUM(status = 'offline')                               AS offline,
  ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 1) AS avg_latency_ms,
  ROUND(AVG(CASE WHEN cpu_pct    IS NOT NULL THEN cpu_pct    END), 1) AS avg_cpu_pct,
  ROUND(AVG(CASE WHEN mem_pct    IS NOT NULL THEN mem_pct    END), 1) AS avg_mem_pct,
  ROUND(100.0 * SUM(status <> 'offline') / GREATEST(COUNT(*),1), 2)  AS uptime_pct
FROM devices;

-- ─────────────────────────────────────────────────────────────
-- STORED PROCEDURE: sp_save_ping
-- ─────────────────────────────────────────────────────────────
DELIMITER $$

CREATE PROCEDURE sp_save_ping(
  IN p_device_id   INT UNSIGNED,
  IN p_status      VARCHAR(10),
  IN p_latency_ms  SMALLINT UNSIGNED,
  IN p_packet_loss TINYINT UNSIGNED
)
BEGIN
  DECLARE v_prev_status VARCHAR(10);
  DECLARE v_prev_uptime DATETIME;

  SELECT status, uptime_start INTO v_prev_status, v_prev_uptime
  FROM devices WHERE id = p_device_id;

  INSERT INTO ping_results (device_id, status, latency_ms, packet_loss)
  VALUES (p_device_id, p_status, p_latency_ms, p_packet_loss);

  UPDATE devices SET
    status     = p_status,
    latency_ms = p_latency_ms,
    uptime_start = CASE
      WHEN p_status <> 'offline' AND (v_prev_uptime IS NULL OR v_prev_status = 'offline') THEN NOW()
      WHEN p_status = 'offline' THEN NULL
      ELSE uptime_start
    END
  WHERE id = p_device_id;

  IF v_prev_status IS NOT NULL AND v_prev_status <> p_status THEN
    IF p_status = 'offline' THEN
      INSERT INTO alerts (device_id, severity, title, detail)
      SELECT p_device_id, 'crit',
        CONCAT('Offline — ', name), CONCAT('Host ', ip, ' parou de responder ao ICMP')
      FROM devices WHERE id = p_device_id;
    ELSEIF v_prev_status = 'offline' THEN
      INSERT INTO alerts (device_id, severity, title, detail)
      SELECT p_device_id, 'info',
        CONCAT('Recuperado — ', name), CONCAT('Host ', ip, ' voltou (', COALESCE(p_latency_ms, '?'), ' ms)')
      FROM devices WHERE id = p_device_id;
    ELSEIF p_status = 'warn' THEN
      INSERT INTO alerts (device_id, severity, title, detail)
      SELECT p_device_id, 'warn',
        CONCAT('Alta Latência — ', name), CONCAT(p_latency_ms, ' ms detectado em ', ip)
      FROM devices WHERE id = p_device_id;
    END IF;
  END IF;

  DELETE FROM ping_results
  WHERE device_id = p_device_id AND id NOT IN (
    SELECT id FROM (
      SELECT id FROM ping_results WHERE device_id = p_device_id
      ORDER BY probed_at DESC LIMIT 10000
    ) t
  );
END$$

DELIMITER ;

-- ─────────────────────────────────────────────────────────────
-- SEED: usuários padrão
-- Senhas pré-hasheadas com bcrypt (custo 10):
--   admin  → Admin@2024!
--   viewer → User@2024!
-- Para alterar as senhas use: node -e "require('bcryptjs').hash('NOVA_SENHA',10).then(console.log)"
-- ─────────────────────────────────────────────────────────────
INSERT INTO users (username, password_hash, full_name, role) VALUES
  ('admin',  '$2b$10$mALIF1atVigM7N1aB7I9ueCQCWMdQoztEKgpzxYD38UHStz9yQbAa', 'Administrador',    'admin'),
  ('viewer', '$2b$10$s8HFIOO.03PVt1A54cpiO.8VVMfxFcdZ/ycMahihFeGeHaoiNII7u', 'Usuário Leitura',  'user')
ON DUPLICATE KEY UPDATE updated_at = NOW();

INSERT INTO alerts (severity, title, detail)
VALUES ('info', 'NEXUS NOC v2 iniciado', 'Schema com autenticação criado com sucesso.');

SELECT 'Schema NEXUS NOC v2.0 criado com sucesso!' AS resultado;
SELECT username, role, full_name FROM users;
