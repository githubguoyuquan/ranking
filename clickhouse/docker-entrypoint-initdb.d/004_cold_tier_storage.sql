-- 冷层存储卷（本地 dev：需 CH server config 声明同名 volume）
-- 生产：S3 / 对象存储 disk；见 docs/ops/SCALE_VALIDATION.md
CREATE VOLUME IF NOT EXISTS cold
    TYPE DISK
    DISK 'cold';
