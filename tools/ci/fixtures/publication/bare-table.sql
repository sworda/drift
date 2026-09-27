-- 坏样例 1（RES-03 的第一条防线）：ADD TABLE 不带列清单。
--
-- 这是 T-13-04（critical）的确切形态：表级默认放行之后，Phase 7 给 message 加一个
-- 向量列时，那个列会被一并复制进研究库，而没有任何检查会变红。
-- NO_BARE_TABLE 必须对本文件失败。

CREATE PUBLICATION research_pub;

ALTER PUBLICATION research_pub ADD TABLE message;
