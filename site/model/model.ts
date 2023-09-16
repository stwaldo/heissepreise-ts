class Model {
    private _listeners: any[];

    constructor() {
        this._listeners = [];
    }

    addListener(listener: any) {
        this._listeners.push(listener);
    }

    removeListener(listener: any) {
        const index = this._listeners.findIndex((item) => item === listener);
        if (index != -1) this._listeners.splice(index, 1);
    }

    notify(exclude?: any) {
        for (const listener of this._listeners) {
            if (exclude && listener != exclude) listener();
        }
    }
}

const _Model = Model;
export { _Model as Model };

export interface Data {
    priceHistory: any;
    stores: string[],
    n: number,
    dates: string[],
    data: string[]
}