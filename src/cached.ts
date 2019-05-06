export default function cached<T>(factory: () => T) {
  const c: { (): T; cache?: T } = () => {
    if (!c.cache) {
      c.cache = factory();
    }

    return c.cache;
  };

  return c;
}
