'use strict';

let Promise = require('bluebird'),
    _ = require('underscore'),
    checkType = require('@kartotherian/input-validator'),
    qidx = require('quadtile-index'),
    Err = require('@kartotherian/err');

let core;


function Demultiplexer(uri, callback) {
    let self = this;
    Promise.try(function () {
        let query = checkType.normalizeUrl(uri).query,
            sources = [];
        // process sourceN, fromN, beforeN - parse them into [{source:..., from:..., before:...}, ...]
        _.each(query, function (val, key) {
            _.each(['source', 'from', 'before'], function (type) {
                if (key.substr(0, type.length) === type) {
                    let ind = checkType.strToInt(key.substr(type.length));
                    // Assume that there can't be more than maxZoom different sources
                    if (!qidx.isValidZoom(ind)) {
                        throw new Err('Unexpected key "%s"', key);
                    }
                    if (type !== 'source') {
                        val = checkType.strToInt(val);
                        if (!qidx.isValidZoom(val)) {
                            throw new Err('Invalid zoom "%s"', val);
                        }
                    }
                    if (!sources[ind]) {
                        sources[ind] = {};
                    }
                    sources[ind][type] = val;
                }
            });
        });

        sources = _.sortBy(_.filter(sources), function (v) {
            return v.from;
        });
        let lastZoom;
        _.each(sources, function (v) {
            if (v.source === undefined || v.from === undefined || v.before === undefined) {
                throw new Err('All three values must be present - "source", "from", and "before"', key);
            }
            if (v.from >= v.before) {
                throw new Err('source\'s "from" must be less than "before"');
            }
            if (lastZoom === undefined) {
                lastZoom = v.before;
            } else if (v.from !== lastZoom) {
                throw new Err('Not all zoom levels are covered, or there is an overlap"');
            }
        });

        self.sources = sources;
        return Promise.each(
            Object.keys(sources),
            key => {
                let src = sources[key];
                return core.loadSource(src.source).then(
                    handler => {
                        src.handler = handler;
                    });
            });
    }).return(this).nodeify(callback);
}

Demultiplexer.prototype._getHandler = function(z) {
    let self = this;
    if (z < self.sources[0].from || z >= self.sources[self.sources.length - 1].before) {
        Err.throwNoTile();
    }
    let srcInd = _.sortedIndex(self.sources, {from: z}, function (v) {
        return v.from;
    });
    return self.sources[srcInd - 1].handler;
};

Demultiplexer.prototype.getTile = function(z, x, y, callback) {
    let self = this;
    return Promise.try(function () {
        return self._getHandler(z).getTileAsync(z, x, y);
    }).nodeify(callback, {spread: true});
};

Demultiplexer.prototype.putTile = function(z, x, y, tile, callback) {
    let self = this;
    return Promise.try(function () {
        return self._getHandler(z).putTileAsync(z, x, y, tile);
    }).nodeify(callback);
};

Demultiplexer.prototype.getInfo = function(callback) {
    return this.sources[0].handler.getInfo(callback);
};


Demultiplexer.initKartotherian = function(cor) {
    core = cor;
    core.tilelive.protocols['demultiplexer:'] = Demultiplexer;
};

module.exports = Demultiplexer;
