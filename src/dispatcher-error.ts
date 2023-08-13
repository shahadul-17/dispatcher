export class DispatcherError extends Error {

  private readonly data: any;

  constructor(data: any = undefined) {
    super(data.message);

    Object.setPrototypeOf(this, new.target.prototype);

    this.data = data;

    if (this.data.stack) {
      this.stack = this.data.stack;
    }
  }
}
