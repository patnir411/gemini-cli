/**
 * Circular buffer for efficient fixed-size event storage
 * Automatically overwrites oldest entries when capacity is reached
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private writeIndex: number = 0;
  private size: number = 0;
  private readonly capacity: number;

  constructor(capacity: number = 10000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Add an item to the buffer
   * Overwrites the oldest item if at capacity
   */
  push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * Get the last N items in chronological order
   */
  getLast(count: number): T[] {
    if (count <= 0 || this.size === 0) {
      return [];
    }

    const itemsToReturn = Math.min(count, this.size);
    const result: T[] = [];

    // Calculate starting read index
    const startIndex =
      this.size < this.capacity
        ? Math.max(0, this.size - itemsToReturn)
        : (this.writeIndex - itemsToReturn + this.capacity) % this.capacity;

    // Read items in order
    for (let i = 0; i < itemsToReturn; i++) {
      const index = (startIndex + i) % this.capacity;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Get all items in chronological order
   */
  getAll(): T[] {
    return this.getLast(this.size);
  }

  /**
   * Get current number of items in buffer
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get maximum capacity
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Check if buffer is at capacity
   */
  isFull(): boolean {
    return this.size === this.capacity;
  }

  /**
   * Clear all items from buffer
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.writeIndex = 0;
    this.size = 0;
  }

  /**
   * Get items within a time range
   * @param startTime Unix timestamp in milliseconds
   * @param endTime Unix timestamp in milliseconds
   * @param getTimestamp Function to extract timestamp from item
   */
  getInTimeRange(
    startTime: number,
    endTime: number,
    getTimestamp: (item: T) => number
  ): T[] {
    return this.getAll().filter((item) => {
      const timestamp = getTimestamp(item);
      return timestamp >= startTime && timestamp <= endTime;
    });
  }

  /**
   * Find items matching a predicate
   */
  find(predicate: (item: T) => boolean): T[] {
    return this.getAll().filter(predicate);
  }

  /**
   * Get the most recent item
   */
  getLatest(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }

    const latestIndex =
      this.size < this.capacity
        ? this.size - 1
        : (this.writeIndex - 1 + this.capacity) % this.capacity;

    return this.buffer[latestIndex];
  }

  /**
   * Get statistics about buffer usage
   */
  getStats(): {
    size: number;
    capacity: number;
    utilizationPercent: number;
    isFull: boolean;
  } {
    return {
      size: this.size,
      capacity: this.capacity,
      utilizationPercent: (this.size / this.capacity) * 100,
      isFull: this.isFull(),
    };
  }
}
