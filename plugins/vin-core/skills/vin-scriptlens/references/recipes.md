# Lens recipes

All of these are function bodies for `-e '...'` or a file for `-f`.

## Shape and size

```js
return { type: Array.isArray(data) ? 'array' : typeof data, length: data.length, keys: Object.keys(data[0] ?? data) }
```

## Count by a field

```js
return count(data, x => x.status)
```

## Top N by a number

```js
return top(data, 10, x => x.duration_ms).map(x => pick(x, 'id', 'name', 'duration_ms'))
```

## Filter, then project

```js
return data.filter(i => i.labels.some(l => l.name === 'bug') && i.state === 'open')
           .map(i => `#${i.number} ${i.title}`)
```

## Join two lists inside one document

```js
const users = Object.fromEntries(data.users.map(u => [u.id, u.name]))
return data.orders.map(o => ({ order: o.id, user: users[o.userId] ?? '(unknown)', total: o.total }))
```

## Totals per group

```js
const g = groupBy(data.items, x => x.category)
return Object.fromEntries(Object.entries(g).map(([k, xs]) => [k, { n: xs.length, total: sum(xs, x => x.price) }]))
```

## Find where an error lives in a deep structure

```js
const hits = []
const walk = (v, p) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/error/i.test(k) && x) hits.push(p + '.' + k); walk(x, p + '.' + k) } }
walk(data, '$')
return hits.slice(0, 50)
```

## Time buckets

```js
return count(data, e => e.timestamp.slice(0, 13)) // per hour, for ISO timestamps
```
