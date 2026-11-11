//#region src/tokens.ts
var e = "embedded";
function t(e) {
	return e?.startsWith("assign:") && e.length > 7 ? {
		kind: "assign",
		profileId: e.slice(7)
	} : { kind: "embedded" };
}
function n(e) {
	return e === "embedded" ? null : `assign:${e}`;
}
function r(n) {
	let r = t(n);
	return r.kind === "assign" ? r.profileId : e;
}
//#endregion
//#region src/menu.ts
var i = "Missing profile", a = /\.(jpe?g|jfif|png|webp|avif|tiff?|ppm|pgm|pbm|pnm)$/i, o = (e) => a.test(e);
function s(t, n, r) {
	let a = [{ items: [{
		value: e,
		label: n
	}] }, {
		title: "Built-in",
		items: t.filter((e) => !e.user).map((e) => ({
			value: e.id,
			label: e.label
		}))
	}], o = t.filter((e) => e.user);
	return o.length && a.push({
		title: "Your profiles",
		items: o.map((e) => ({
			value: e.id,
			label: e.label
		}))
	}), r !== "embedded" && !t.some((e) => e.id === r) && a.push({ items: [{
		value: r,
		label: i,
		disabled: !0
	}] }), a;
}
//#endregion
//#region src/containers.ts
var c = class extends Error {};
function l(e) {
	return {
		size: e.size,
		async read(t, n) {
			if (t < 0 || n < 0 || t + n > e.size) throw new c();
			return new Uint8Array(await e.slice(t, t + n).arrayBuffer());
		}
	};
}
var u = (e, t, n) => String.fromCharCode(...e.subarray(t, t + n)), d = (e, t) => e[t] << 8 | e[t + 1], f = (e, t) => (e[t] << 24 | e[t + 1] << 16 | e[t + 2] << 8 | e[t + 3]) >>> 0, p = (e, t) => (e[t + 3] << 24 | e[t + 2] << 16 | e[t + 1] << 8 | e[t]) >>> 0;
function m(e) {
	let t = new Uint8Array(e.reduce((e, t) => e + t.length, 0)), n = 0;
	for (let r of e) t.set(r, n), n += r.length;
	return t;
}
var h = (e) => ({
	kind: "icc",
	bytes: e
}), g = "ICC_PROFILE\0", _ = 218, v = 217;
async function y(e) {
	let t = /* @__PURE__ */ new Map(), n = 0, r = 2;
	for (; r + 4 <= e.size;) {
		let i = await e.read(r, 4);
		if (i[0] !== 255) return null;
		let a = i[1];
		if (a === 255) {
			r += 1;
			continue;
		}
		if (a === _ || a === v) break;
		if (a >= 208 && a <= 215 || a === 1) {
			r += 2;
			continue;
		}
		let o = d(i, 2);
		if (o < 2) return null;
		if (a === 226 && o >= 16) {
			let i = await e.read(r + 4, o - 2);
			if (u(i, 0, 12) === g) {
				let e = i[12];
				n = i[13], t.set(e, i.subarray(14));
			}
		}
		r += 2 + o;
	}
	if (n === 0) return null;
	let i = [];
	for (let e = 1; e <= n; e++) {
		let n = t.get(e);
		if (!n) return null;
		i.push(n);
	}
	return h(m(i));
}
async function b(e) {
	let t = new Blob([e]).stream().pipeThrough(new DecompressionStream("deflate"));
	return new Uint8Array(await new Response(t).arrayBuffer());
}
async function ee(e) {
	let t = 8;
	for (; t + 8 <= e.size;) {
		let n = await e.read(t, 8), r = f(n, 0), i = u(n, 4, 4);
		if (i === "IDAT" || i === "IEND") return null;
		if (i === "iCCP") {
			let n = await e.read(t + 8, r), i = n.indexOf(0);
			return i < 1 || n[i + 1] !== 0 ? null : h(await b(n.subarray(i + 2)));
		}
		t += 12 + r;
	}
	return null;
}
async function x(e) {
	let t = 12;
	for (; t + 8 <= e.size;) {
		let n = await e.read(t, 8), r = p(n, 4);
		if (u(n, 0, 4) === "ICCP") return h(await e.read(t + 8, r));
		t += 8 + r + r % 2;
	}
	return null;
}
var te = 34675;
async function S(e, t) {
	let n = (e, n) => t ? e[n] | e[n + 1] << 8 : d(e, n), r = (e, n) => t ? p(e, n) : f(e, n), i = r(await e.read(4, 4), 0), a = n(await e.read(i, 2), 0), o = await e.read(i + 2, a * 12);
	for (let t = 0; t < a; t++) {
		let i = t * 12;
		if (n(o, i) !== te) continue;
		let a = r(o, i + 4);
		return a > 4 ? h(await e.read(r(o, i + 8), a)) : null;
	}
	return null;
}
async function C(e, t, n) {
	let r = [], i = t;
	for (; i + 8 <= n;) {
		let t = await e.read(i, 8), a = f(t, 0), o = 8;
		if (a === 1) {
			let t = await e.read(i + 8, 8);
			a = f(t, 0) * 2 ** 32 + f(t, 4), o = 16;
		} else a === 0 && (a = n - i);
		if (a < o || i + a > n) throw new c();
		r.push({
			type: u(t, 4, 4),
			start: i + o,
			end: i + a
		}), i += a;
	}
	return r;
}
async function w(e, t, n, r = 0) {
	return (await C(e, t.start + r, t.end)).find((e) => e.type === n) ?? null;
}
async function ne(e) {
	let t = (await C(e, 0, e.size)).find((e) => e.type === "meta");
	if (!t) return null;
	let n = await w(e, t, "iprp", 4), r = n && await w(e, n, "ipco");
	if (!r) return null;
	let i = null;
	for (let t of await C(e, r.start, r.end)) {
		if (t.type !== "colr" || t.end - t.start < 4) continue;
		let n = u(await e.read(t.start, 4), 0, 4);
		if (n === "prof" || n === "rICC") return h(await e.read(t.start + 4, t.end - t.start - 4));
		if (n === "nclx" && !i && t.end - t.start >= 8) {
			let n = await e.read(t.start + 4, 4);
			i = {
				kind: "nclx",
				primaries: d(n, 0),
				transfer: d(n, 2)
			};
		}
	}
	return i;
}
async function T(e) {
	if (e.size < 12) return null;
	let t = l(e);
	try {
		let e = await t.read(0, 12);
		return e[0] === 255 && e[1] === 216 ? await y(t) : f(e, 0) === 2303741511 ? await ee(t) : u(e, 0, 4) === "RIFF" && u(e, 8, 4) === "WEBP" ? await x(t) : u(e, 0, 4) === "II*\0" ? await S(t, !0) : u(e, 0, 4) === "MM\0*" ? await S(t, !1) : u(e, 4, 4) === "ftyp" ? await ne(t) : null;
	} catch {
		return null;
	}
}
//#endregion
//#region src/profile.ts
var E = {
	notIcc: "This file isn't an ICC profile, or it's damaged.",
	colorSpace: "This profile isn't for RGB or greyscale images.",
	noMatrix: "This profile has no matrix and tone curves. Profiles made as \"curves + matrix\" or \"single curve + matrix\" work.",
	noGrayCurve: "This greyscale profile has no tone curve.",
	curveType: "This profile uses a tone curve type Safelight can't read.",
	primaries: "This profile's primaries don't describe red, green and blue. Profiles built with a swapped matrix aren't supported."
}, re = 128, D = 256, ie = [
	1,
	3,
	4,
	5,
	7
], O = (e, t) => String.fromCharCode(e[t], e[t + 1], e[t + 2], e[t + 3]), ae = (e) => Math.min(1, Math.max(0, e));
function oe(e, t, n) {
	let r = t.getUint32(re);
	if (132 + r * 12 > n) return null;
	let i = /* @__PURE__ */ new Map();
	for (let a = 0; a < r; a++) {
		let r = 132 + a * 12, o = {
			offset: t.getUint32(r + 4),
			size: t.getUint32(r + 8)
		};
		if (o.offset + o.size > n) return null;
		i.set(O(e, r), o);
	}
	return i;
}
function se(e, t, n) {
	if (n.size < 20 || O(e, n.offset) !== "XYZ ") return null;
	let r = n.offset + 8;
	return [
		t.getInt32(r) / 65536,
		t.getInt32(r + 4) / 65536,
		t.getInt32(r + 8) / 65536
	];
}
function ce(e, t, n) {
	let r = n.offset;
	if (n.size < 12) return E.notIcc;
	let i = O(e, r);
	if (i === "curv") {
		let e = t.getUint32(r + 8);
		if (n.size < 12 + e * 2) return E.notIcc;
		if (e === 0) return (e) => e;
		if (e === 1) {
			let e = t.getUint16(r + 12) / 256;
			return (t) => t ** +e;
		}
		let i = Array.from({ length: e }, (e, n) => t.getUint16(r + 12 + n * 2) / 65535);
		return (t) => {
			let n = ae(t) * (e - 1), r = Math.min(e - 2, Math.floor(n));
			return i[r] + (i[r + 1] - i[r]) * (n - r);
		};
	}
	if (i !== "para") return E.curveType;
	let a = t.getUint16(r + 8), o = ie[a];
	if (o === void 0) return E.curveType;
	if (n.size < 12 + o * 4) return E.notIcc;
	let [s, c, l, u, d, f, p] = Array.from({ length: o }, (e, n) => t.getInt32(r + 12 + n * 4) / 65536);
	switch (a) {
		case 0: return (e) => e ** +s;
		case 1: return (e) => e >= -l / c ? (c * e + l) ** +s : 0;
		case 2: return (e) => e >= -l / c ? (c * e + l) ** +s + u : u;
		case 3: return (e) => e >= d ? (c * e + l) ** +s : u * e;
		default: return (e) => e >= d ? (c * e + l) ** +s + f : u * e + p;
	}
}
function le(e, t, n) {
	if (!n || n.size < 12) return "";
	let r = n.offset, i = "", a = O(e, r);
	if (a === "desc") {
		let a = t.getUint32(r + 8);
		if (12 + a > n.size) return "";
		for (let t = 0; t < Math.min(a, D); t++) i += String.fromCharCode(e[r + 12 + t]);
	} else if (a === "mluc") {
		if (n.size < 28 || t.getUint32(r + 8) < 1) return "";
		let e = Math.min(t.getUint32(r + 20), D * 2), a = t.getUint32(r + 24);
		if (a + e > n.size) return "";
		for (let n = 0; n + 1 < e; n += 2) i += String.fromCharCode(t.getUint16(r + a + n));
	}
	return i.split("\0")[0].trim();
}
function k([e, t, n]) {
	let r = e + t + n;
	return r > 0 ? [e / r, t / r] : [NaN, NaN];
}
function ue(e, t, n) {
	let [r, i] = k(e), [a, o] = k(t), [s, c] = k(n);
	return r > a && r > s && o > i && o > c && c < i;
}
function de(e, t, n) {
	let r = [];
	for (let i of n) {
		let n = ce(e, t, i);
		if (typeof n == "string") return n;
		r.push(n);
	}
	return r;
}
function A(e) {
	if (e.length < 132) return "";
	let t = new DataView(e.buffer, e.byteOffset, e.byteLength), n = t.getUint32(0);
	if (O(e, 36) !== "acsp" || n > e.length) return "";
	let r = oe(e, t, n);
	return r ? le(e, t, r.get("desc")) : "";
}
function j(e) {
	let t = (e) => ({
		ok: !1,
		error: e
	});
	if (e.length < 132) return t(E.notIcc);
	let n = new DataView(e.buffer, e.byteOffset, e.byteLength), r = n.getUint32(0);
	if (O(e, 36) !== "acsp" || r < 132 || r > e.length) return t(E.notIcc);
	let i = oe(e, n, r);
	if (!i) return t(E.notIcc);
	let a = le(e, n, i.get("desc")), o = O(e, 16);
	if (o === "GRAY") {
		let r = i.get("kTRC");
		if (!r) return t(E.noGrayCurve);
		let o = ce(e, n, r);
		return typeof o == "string" ? t(o) : {
			ok: !0,
			profile: {
				kind: "gray",
				description: a,
				curves: [
					o,
					o,
					o
				]
			}
		};
	}
	if (o !== "RGB ") return t(E.colorSpace);
	let s = [
		"rXYZ",
		"gXYZ",
		"bXYZ"
	].map((e) => i.get(e)), c = [
		"rTRC",
		"gTRC",
		"bTRC"
	].map((e) => i.get(e));
	if (s.some((e) => !e) || c.some((e) => !e)) return t(E.noMatrix);
	let l = [];
	for (let r of s) {
		let i = se(e, n, r);
		if (!i) return t(E.notIcc);
		l.push(i);
	}
	let u = de(e, n, c);
	if (typeof u == "string") return t(u);
	let [d, f, p] = l;
	return ue(d, f, p) ? {
		ok: !0,
		profile: {
			kind: "rgb",
			description: a,
			colorants: [
				d,
				f,
				p
			],
			curves: [
				u[0],
				u[1],
				u[2]
			]
		}
	} : t(E.primaries);
}
//#endregion
//#region src/spaces.ts
var M = [
	[
		.436026,
		.222478,
		.013926
	],
	[
		.385098,
		.716899,
		.097091
	],
	[
		.143088,
		.060623,
		.714172
	]
], N = [
	[
		.5151,
		.241181,
		-.001049
	],
	[
		.291962,
		.692238,
		.041882
	],
	[
		.157149,
		.066581,
		.784356
	]
], fe = [
	[
		.60972,
		.311103,
		.019473
	],
	[
		.205262,
		.625671,
		.060884
	],
	[
		.14923,
		.063226,
		.74483
	]
], pe = [
	[
		.797667,
		.288037,
		0
	],
	[
		.135192,
		.711877,
		0
	],
	[
		.031353,
		86e-6,
		.825188
	]
], P = [
	[
		.673459,
		.279033,
		-.001931
	],
	[
		.165661,
		.675338,
		.029979
	],
	[
		.125092,
		.045626,
		.797134
	]
], F = (e) => e <= .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4, me = (e) => e ** (563 / 256), he = (e) => e < 1 / 32 ? e / 16 : e ** 1.8, I = (e) => e < .081242858 ? e / 4.5 : ((e + .099) / 1.099) ** (1 / .45), L = (e) => e, R = (e) => (t) => t ** +e, z = (e, t, n) => ({
	kind: "rgb",
	description: e,
	colorants: t,
	curves: [
		n,
		n,
		n
	]
}), B = "srgb", V = [
	{
		id: B,
		label: "sRGB",
		profile: z("sRGB", M, F)
	},
	{
		id: "display-p3",
		label: "Display P3",
		profile: z("Display P3", N, F)
	},
	{
		id: "adobe-rgb",
		label: "Adobe RGB (1998)",
		profile: z("Adobe RGB (1998)", fe, me)
	},
	{
		id: "prophoto-rgb",
		label: "ProPhoto RGB",
		profile: z("ProPhoto RGB", pe, he)
	},
	{
		id: "rec2020",
		label: "Rec. 2020",
		profile: z("Rec. 2020", P, I)
	},
	{
		id: "linear-srgb",
		label: "Linear sRGB",
		profile: z("Linear sRGB", M, L)
	}
];
function ge(e) {
	return V.find((t) => t.id === e)?.profile ?? null;
}
var _e = {
	1: {
		name: "sRGB",
		colorants: M,
		usual: [13]
	},
	9: {
		name: "Rec. 2020",
		colorants: P,
		usual: [
			1,
			6,
			14,
			15
		]
	},
	12: {
		name: "Display P3",
		colorants: N,
		usual: [13]
	}
}, ve = {
	1: {
		name: "Rec. 709 curve",
		curve: I
	},
	4: {
		name: "gamma 2.2",
		curve: R(2.2)
	},
	5: {
		name: "gamma 2.8",
		curve: R(2.8)
	},
	6: {
		name: "Rec. 709 curve",
		curve: I
	},
	8: {
		name: "linear",
		curve: L
	},
	13: {
		name: "sRGB curve",
		curve: F
	},
	14: {
		name: "Rec. 709 curve",
		curve: I
	},
	15: {
		name: "Rec. 709 curve",
		curve: I
	}
};
function H({ primaries: e, transfer: t }) {
	let n = _e[e], r = ve[t];
	return !n || !r ? null : z(n.usual.includes(t) ? n.name : `${n.name}, ${r.name}`, n.colorants, r.curve);
}
//#endregion
//#region src/library.ts
var U = "userProfiles", W = "user:";
function ye(e) {
	let t = "";
	for (let n = 0; n < e.length; n += 32768) t += String.fromCharCode(...e.subarray(n, n + 32768));
	return btoa(t);
}
function be(e) {
	try {
		return Uint8Array.from(atob(e), (e) => e.charCodeAt(0));
	} catch {
		return null;
	}
}
async function xe(e) {
	let t = await crypto.subtle.digest("SHA-1", e);
	return Array.from(new Uint8Array(t), (e) => e.toString(16).padStart(2, "0")).join("");
}
var Se = (e) => typeof e == "object" && !!e && typeof e.id == "string" && typeof e.label == "string" && typeof e.data == "string", Ce = V.map(({ id: e, label: t, profile: n }) => ({
	id: e,
	label: t,
	profile: n,
	user: !1
})), we = class {
	settings;
	userEntries = [];
	constructor(e) {
		this.settings = e, this.reload();
	}
	reload() {
		this.userEntries = [];
		for (let e of this.stored()) {
			let t = be(e.data), n = t && j(t);
			n?.ok && this.userEntries.push({
				id: e.id,
				label: e.label,
				profile: n.profile,
				user: !0
			});
		}
	}
	list() {
		return [...Ce, ...this.userEntries];
	}
	get(e) {
		return this.list().find((t) => t.id === e) ?? null;
	}
	async add(e, t) {
		let n = j(e);
		if (!n.ok) return n;
		let r = `${W}${await xe(e)}`, i = this.get(r);
		if (i) return {
			ok: !0,
			entry: i
		};
		let a = A(e) || t.replace(/\.(icc|icm)$/i, "");
		return this.settings.set(U, [...this.stored(), {
			id: r,
			label: a,
			data: ye(e)
		}]), this.reload(), {
			ok: !0,
			entry: this.get(r)
		};
	}
	remove(e) {
		e.startsWith(W) && (this.settings.set(U, this.stored().filter((t) => t.id !== e)), this.reload());
	}
	stored() {
		let e = this.settings.get(U, []);
		return Array.isArray(e) ? e.filter(Se) : [];
	}
}, Te = 4096, Ee = [
	1,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	1
], De = (e, t, n) => [
	e[0],
	t[0],
	n[0],
	e[1],
	t[1],
	n[1],
	e[2],
	t[2],
	n[2]
];
function Oe(e, t) {
	let n = [];
	for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) {
		let a = 0;
		for (let n = 0; n < 3; n++) a += e[r * 3 + n] * t[n * 3 + i];
		n.push(a);
	}
	return n;
}
function ke(e) {
	let [t, n, r, i, a, o, s, c, l] = e, u = a * l - o * c, d = o * s - i * l, f = i * c - a * s, p = t * u + n * d + r * f;
	return [
		u / p,
		(r * c - n * l) / p,
		(n * o - r * a) / p,
		d / p,
		(t * l - r * s) / p,
		(r * i - t * o) / p,
		f / p,
		(n * s - t * c) / p,
		(t * a - n * i) / p
	];
}
var Ae = ge(B), je = ke(De(...Ae.colorants));
function G(e) {
	let t = new Float32Array(Te);
	for (let n = 0; n < Te; n++) t[n] = e(n / 4095);
	return t;
}
function Me(e) {
	let [t, n, r] = e.curves;
	return {
		trc: [
			G(t),
			G(n),
			G(r)
		],
		toRec709: e.kind === "gray" ? [...Ee] : Oe(je, De(...e.colorants))
	};
}
var Ne = .002, Pe = .001, Fe = Me(Ae).trc[0];
function Ie(e) {
	return !e.toRec709.some((e, t) => Math.abs(e - Ee[t]) > Ne) && e.trc.every((e) => e.every((e, t) => Math.abs(e - Fe[t]) <= Pe));
}
//#endregion
//#region src/resolver.ts
var Le = 32;
async function Re(e) {
	if (e.kind === "nclx") return {
		key: `nclx:${e.primaries}/${e.transfer}`,
		profile: H(e)
	};
	let t = j(e.bytes);
	return {
		key: `icc:${await xe(e.bytes)}`,
		profile: t.ok ? t.profile : null
	};
}
function ze({ library: e, untaggedProfileId: n }) {
	let r = /* @__PURE__ */ new Map();
	function i({ key: e, profile: t }) {
		let n = r.get(e);
		if (n) return n;
		let i = Me(t), a = {
			transform: i,
			srgb: Ie(i)
		};
		return r.size >= Le && r.delete(r.keys().next().value), r.set(e, a), a;
	}
	let a = (t) => {
		let n = e.get(t);
		return n ? {
			key: `id:${n.id}`,
			profile: n.profile
		} : null;
	};
	return { async resolve(e, r) {
		let o = await T(r), s = o ? await Re(o) : null;
		if (s && !s.profile) return null;
		let c = s?.profile ? i({
			key: s.key,
			profile: s.profile
		}) : null, l = t(e.inputProfile), u = (l.kind === "assign" ? a(l.profileId) : null) ?? (s?.profile ? null : a(n())), d = u ? i(u) : c;
		if (!d) return null;
		let f = !c || c.srgb;
		return d.srgb && f ? null : d.transform;
	} };
}
async function Be(e) {
	let t = await T(e);
	if (!t) return { kind: "none" };
	if (t.kind === "nclx") {
		let e = H(t);
		return e ? {
			kind: "profile",
			name: e.description
		} : {
			kind: "unsupported",
			name: "Colour codes",
			reason: "They describe HDR or a space this extension doesn't read."
		};
	}
	let n = j(t.bytes), r = A(t.bytes) || "Unnamed profile";
	return n.ok ? {
		kind: "profile",
		name: r
	} : {
		kind: "unsupported",
		name: r,
		reason: n.error
	};
}
//#endregion
//#region src/rt.ts
var K, q;
function Ve(e) {
	q = e, K = e.react;
}
//#endregion
//#region src/Panel.tsx
function He(e) {
	return K.useSyncExternalStore(e.subscribe, e.revision);
}
function Ue(e) {
	let [t, n] = K.useState(null), r = e?.id;
	return K.useEffect(() => {
		if (!e?.fileHandle || !o(e.filename)) return;
		let t = !0;
		return e.fileHandle.getFile().then(Be).then((r) => t && n({
			id: e.id,
			description: r
		})).catch(() => {}), () => {
			t = !1;
		};
	}, [r]), t && t.id === r ? t.description : null;
}
function We(e, t) {
	return e ? e.kind === "none" ? `No profile: read as ${t}` : `Embedded: ${e.name}` : "Embedded profile";
}
function Ge({ controller: e }) {
	He(e);
	let { Select: t, Button: n, Field: a, Stack: c, Row: l, tokens: u, alertDialog: d, confirmDialog: f } = q.ui, p = q.catalog.useActivePhoto(), m = Ue(p), h = (e) => /* @__PURE__ */ K.createElement("div", { style: {
		padding: 8,
		color: u.textMuted,
		fontSize: 11
	} }, e);
	if (!p) return h("No photo is open.");
	if (!o(p.filename)) return h("RAW photos take their colour from the camera, not from a profile.");
	let g = r(p.inputProfile), _ = e.entries(), v = s(_, We(m, e.library.get(e.untagged())?.label ?? "sRGB"), g), y = _.find((e) => e.id === g), b = m?.kind === "unsupported", ee = b ? `${m.name}: ${m.reason} Safelight's standard decode shows this photo.` : g !== "embedded" && !y ? `${i}: it was removed, so the embedded profile is used.` : void 0;
	async function x() {
		let t = await q.presets.pickFile(".icc,.icm");
		if (!t) return;
		let n = await e.addFromFile(t);
		n.ok ? p && await e.assign([p.id], n.entry.id) : await d({
			title: "Couldn't add this profile",
			message: n.error
		});
	}
	async function te() {
		y?.user && await f({
			title: `Remove ${y.label}?`,
			message: "Photos given this profile go back to their embedded profile.",
			confirmLabel: "Remove",
			variant: "danger"
		}) && e.remove(y.id);
	}
	return /* @__PURE__ */ K.createElement("div", { style: { padding: 8 } }, /* @__PURE__ */ K.createElement(c, { gap: 8 }, /* @__PURE__ */ K.createElement(a, {
		label: "Input profile",
		hint: ee
	}, /* @__PURE__ */ K.createElement(t, {
		value: g,
		groups: v,
		disabled: b,
		ariaLabel: "Input profile",
		onChange: (t) => void e.assign([p.id], t)
	})), /* @__PURE__ */ K.createElement(l, { gap: 6 }, /* @__PURE__ */ K.createElement(n, {
		size: "sm",
		variant: "secondary",
		onClick: () => void x()
	}, "Add profile…"), y?.user ? /* @__PURE__ */ K.createElement(n, {
		size: "sm",
		variant: "ghost",
		onClick: () => void te()
	}, "Remove") : null)));
}
//#endregion
//#region src/AssignDialog.tsx
var J = null, Y = /* @__PURE__ */ new Set();
function Ke(e) {
	J = e.length ? e : null;
	for (let e of Y) e(J);
}
function X() {
	Ke([]);
}
function qe() {
	let [e, t] = K.useState(J);
	return K.useEffect(() => (Y.add(t), () => void Y.delete(t)), []), e;
}
function Je({ controller: t }) {
	He(t);
	let n = qe(), [r, i] = K.useState(e), { Select: a, Button: o, Row: c, Stack: l, tokens: u } = q.ui;
	if (K.useEffect(() => {
		if (!n) return;
		i(e);
		let t = (e) => {
			e.key === "Escape" && X();
		};
		return window.addEventListener("keydown", t), () => window.removeEventListener("keydown", t);
	}, [n]), !n) return null;
	let d = n.length === 1 ? "1 photo" : `${n.length} photos`;
	async function f() {
		n && (await t.assign(n, r), X());
	}
	return q.reactDom.createPortal(/* @__PURE__ */ K.createElement("div", {
		role: "presentation",
		onMouseDown: (e) => e.target === e.currentTarget && X(),
		style: {
			position: "fixed",
			inset: 0,
			zIndex: 1e3,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			background: "rgba(0, 0, 0, 0.5)"
		}
	}, /* @__PURE__ */ K.createElement("div", {
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "Assign input profile",
		style: {
			width: 320,
			padding: 16,
			borderRadius: 8,
			background: u.surface2,
			border: `1px solid ${u.border}`,
			color: u.textPrimary
		}
	}, /* @__PURE__ */ K.createElement(l, { gap: 12 }, /* @__PURE__ */ K.createElement("div", { style: { fontWeight: 600 } }, "Input profile for ", d), /* @__PURE__ */ K.createElement(a, {
		value: r,
		groups: s(t.entries(), "Embedded profile", r),
		ariaLabel: "Input profile",
		onChange: i
	}), /* @__PURE__ */ K.createElement(c, {
		gap: 8,
		justify: "flex-end"
	}, /* @__PURE__ */ K.createElement(o, {
		variant: "ghost",
		onClick: X
	}, "Cancel"), /* @__PURE__ */ K.createElement(o, {
		variant: "primary",
		onClick: () => void f()
	}, "Assign"))))), document.body);
}
//#endregion
//#region src/controller.ts
var Z = "input-colour-profiles", Ye = "untagged", Xe = "This profile is over 1 MB. Safelight reads only a profile's matrix and tone curves, so use a matrix profile.";
function Ze(e) {
	let t = new we(e.settings), r = () => {
		let n = e.settings.get(Ye, B);
		return t.get(n) ? n : B;
	}, i = ze({
		library: t,
		untaggedProfileId: r
	}), a = /* @__PURE__ */ new Set(), o = 0, s = () => {
		o++;
		for (let e of a) e();
	}, c = e.settings.onChange((n) => {
		n === "userProfiles" && t.reload(), (n === "userProfiles" || n === "untagged") && (e.develop.invalidateInputProfiles(), s());
	});
	return {
		library: t,
		resolver: i,
		untagged: r,
		entries: () => t.list(),
		assign: (t, r) => e.catalog.setInputProfile(t, n(r)),
		async addFromFile(e) {
			return e.size > 1048576 ? {
				ok: !1,
				error: Xe
			} : t.add(new Uint8Array(await e.arrayBuffer()), e.name);
		},
		remove: (e) => t.remove(e),
		subscribe(e) {
			return a.add(e), () => void a.delete(e);
		},
		revision: () => o,
		dispose() {
			c(), a.clear();
		}
	};
}
//#endregion
//#region src/index.tsx
var Qe = `${Z}.panel`, $e = `${Z}.assign`, et = `${Z}.dialog`, Q = null;
function $(e, t) {
	e.registerSettings({ fields: [{
		key: Ye,
		label: "Files without a profile",
		hint: "The profile a photo with no embedded profile is read as.",
		type: "select",
		default: B,
		options: t.entries().map((e) => ({
			value: e.id,
			label: e.label
		}))
	}] });
}
function tt(e) {
	Ve(e), Q?.dispose();
	let t = Ze(e);
	Q = t, e.develop.registerInputProfiles(t.resolver), $(e, t), t.subscribe(() => $(e, t)), e.registerPanel({
		id: Qe,
		title: "Input Profile",
		component: () => /* @__PURE__ */ K.createElement(Ge, { controller: t }),
		defaultDock: {
			module: "develop",
			direction: "right"
		}
	}), e.registerGridMenuItem({
		id: $e,
		label: (e) => e.length > 1 ? `Assign input profile… (${e.length})` : "Assign input profile…",
		onClick: Ke
	}), e.registerSlot({
		id: et,
		slot: "library-toolbar",
		component: () => /* @__PURE__ */ K.createElement(Je, { controller: t })
	});
}
function nt() {
	Q?.dispose(), Q = null;
}
//#endregion
export { et as DIALOG_SLOT_ID, $e as MENU_ID, Qe as PANEL_ID, tt as activate, nt as deactivate };

//# sourceMappingURL=index.js.map