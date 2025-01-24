export default function debounce<T>(
  func: (args: T[]) => void,
  timeout: number,
): (arg: T) => void {
  let timer: ReturnType<typeof setTimeout>;
  let args: T[] = [];
  return (arg: T) => {
    args.push(arg);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const argscopy = args;
      args = [];
      func(argscopy);
    }, timeout);
  };
}
