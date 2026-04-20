export default (element) => {
  let n = 0;
  return {
    next() {
      n += 1;
      return n;
    },
  };
};
