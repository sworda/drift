-- 坏样例 2（RES-02）：列清单是显式的，但其中一列是向量列。
--
-- embedding 在配套的假 schema（fake-vector-schema.ts）里声明为 halfvec(1024)。
-- 显式列清单让它通过了 NO_BARE_TABLE —— 于是本文件测的确实是 NO_VECTOR_COLUMN
-- 而不是第一条。嵌入反演是成熟攻击面，所以这一条的严重度同样是 critical。

CREATE PUBLICATION research_pub;

ALTER PUBLICATION research_pub ADD TABLE memory (id, embedding);
