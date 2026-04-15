import { useState, useMemo } from 'react';

type Dir = 'asc' | 'desc';

/**
 * Hook reutilizabil pentru sortare pe coloană.
 *
 * @param data       - Array-ul de date de sortat
 * @param defaultCol - Coloana implicită (null = fără sortare)
 * @param defaultDir - Direcția implicită ('asc' | 'desc')
 *
 * @returns sorted   - Array sortat
 * @returns toggle   - Apelează cu o cheie de coloană; primul click = asc,
 *                     click repetat pe aceeași coloană = toggle asc/desc
 * @returns icon     - Returnează '↑' / '↓' / '↕' pentru o coloană dată
 */
export function useSort<T extends object>(
  data: T[],
  defaultCol: keyof T | null = null,
  defaultDir: Dir = 'asc',
) {
  const [col, setCol] = useState<keyof T | null>(defaultCol);
  const [dir, setDir] = useState<Dir>(defaultDir);

  function toggle(newCol: keyof T) {
    if (col === newCol) {
      setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setCol(newCol);
      setDir('asc');
    }
  }

  const sorted = useMemo(() => {
    if (!col) return data;
    return [...data].sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      let cmp = 0;
      if (av instanceof Date && bv instanceof Date) {
        cmp = av.getTime() - bv.getTime();
      } else if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'ro');
      }
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [data, col, dir]);

  function icon(c: keyof T): string {
    if (col !== c) return '↕';
    return dir === 'asc' ? '↑' : '↓';
  }

  return { sorted, col, dir, toggle, icon };
}
