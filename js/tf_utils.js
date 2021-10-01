/*! 
	Copyright 2021 Raiza Hanada, Damien Masson, Géry Casiez, Mathieu Nancel, Sylvain Malacria
    (Université de Lille, CNRS, Centrale Lille, UMR 9189 CRIStAL, University of Waterloo)
	See LICENSE.md
*/
var tf = new function() {
	this.tfCache = {};
	this.tfPaths = [];

	this.whenAvailable = function(onComplete) {
		var fullyLoaded = true;

		for (const [tfFile, value] of Object.entries(this.tfCache)) {
			if (!value) {
				fullyLoaded = false;
				var request = new XMLHttpRequest();
				var url = window.location.href;
				var parentUrl = url.substring(0, url.lastIndexOf('/'));
				request.open('GET', parentUrl+tfFile, true);
				request.send(null);
				var self = this;
				request.onreadystatechange = function () {
					if (this.readyState === 4 && this.status === 200) {
						var type = this.getResponseHeader('Content-Type');
						if (type.indexOf("text") !== 1) {
							// Parse the TF curve and store it in cache
							counts = {}
							for (const l of this.responseText.split("\n")) {
								var line = l.split("#")[0].trim();
								if (line.length > 0) {
									var split = line.split(":");
									var key = split[0].trim();
									var v = split[1].trim();
	
									if (!key.includes("max-count")) {
										counts[parseInt(key)] = parseFloat(v);
									}
								}
	
							}
	
							self.tfCache[tfFile] = counts;
							
							// If cache fully loaded, we call the callback
							var fullyLoaded = true;
							for (const [tfFile, value] of Object.entries(self.tfCache)) {
								if (!value) {
									fullyLoaded = false;
								}
							}
	
							if (fullyLoaded) {
								onComplete();
							}
						}
					}
				}
			}
		}

		// If all the tfs are already loaded, we can call onComplete right away
		if (fullyLoaded) {
			onComplete();
		}
	}

	this.getMotorSpeed = function(counts, cpi, pollRate, in2m=true) {
		motorSpeed = []
		var convert = 1;
		if (in2m) convert = 0.0254;
		for (const [key, value] of Object.entries(counts)) {
			motorSpeed.push((key/cpi)*convert*pollRate)
		}

		return motorSpeed;
	}

	this.getVisualSpeed = function(counts, dpi, pollRate) {
		visualSpeed = []
		for (const [key, value] of Object.entries(counts)) {
			visualSpeed.push((value/dpi)*0.0254*pollRate)
		}

		return visualSpeed;
	}

	function getTriangleArea(a, b, c) {
		return Math.abs(0.5*(a.x*(b.y - c.y) + b.x*(c.y - a.y) + c.x*(a.y - b.y)));
	}

	function det(a, b) {
		return a.x*b.y - a.y*b.x;
	}

	// Get the coordinates where line AB meets CD
	function getLineIntersection(a, b, c, d) {
		xdiff = {x: a.x - b.x, y: c.x - d.x}
		ydiff = {x: a.y - b.y, y: c.y - d.y};

		div = det(xdiff, ydiff);
		if (div === 0) {
			// Lines are parallel, so no intersection
			return null;
		}

		d = {x: det(a, b), y: det(c, d)};
		x = det(d, xdiff) / div;
		y = det(d, ydiff) / div;
		return {x:x, y:y};
	}

	function isBetween2D(pt, a, b) {
		return pt.x > Math.min(a.x, b.x) && pt.x < Math.max(a.x, a.x) && 
		pt.y > Math.min(a.y, b.y) && pt.y < Math.max(a.y, a.y);
	}

	// Get the area of a quadrilateral defined by 4 coordinates as A->B->C->D
	function getQuadrilateralArea(a, b, c, d) {
		// Because we know that A is always connected to B and D, and that B is always connected to A and C
		// there is only two cases in which the quadrilateral is convex
		var intersectABnCD = getLineIntersection(a, b, c, d);
		var intersectADnBC = getLineIntersection(a, d, b, c);

		if (intersectABnCD !== null && isBetween2D(intersectABnCD, a, b) && isBetween2D(intersectABnCD, c, d)) {
			// AB crosses CD, the area is going to be the area of the two triangles formed by the intersection
			return getTriangleArea(a, intersectABnCD, d) + getTriangleArea(c, intersectABnCD, b);
		} else if (intersectADnBC !== null && isBetween2D(intersectADnBC, a, d) && isBetween2D(intersectADnBC, b, c)) {
			// AD crosses BC, the area is going to be the area of the two triangles formed by the intersection
			return getTriangleArea(a, intersectADnBC, b) + getTriangleArea(c, intersectADnBC, d);
		}
		return getTriangleArea(a, b, d) + getTriangleArea(b, d, c);
	}

	function dist(a, b) {
		var dx = a.x - b.x;
		var dy = a.y - b.y;

		return Math.sqrt( dx*dx + dy*dy );
	}

	// Resamples a curve so that it has a value for each given x position
	function resampleAtGivenPos(c1, positionx) {
		var targeti = 0;
		var i = 1;
		var D = 0;

		curve = {x:[], y:[]};

		while (i < c1.x.length && targeti < positionx.length) {
			var d =  c1.x[i] - c1.x[i-1];
			if (D + d >= positionx[targeti]) {
				var ptx = positionx[targeti];
				var alpha = (positionx[targeti] - c1.x[i-1])/d;
				var pty = c1.y[i-1] * (1-alpha) + c1.y[i] * alpha;
				curve.x.push(ptx);
				curve.y.push(pty);
				targeti++;
			} else {
				++i;
				D += d;
			}
		}

		return curve;
	}

	this.getAreaBetweenCurve = function(c1, c2) {
		// First, we simplify the problem by resampling the two curves so that
		// 1) They have the same number of points
		// 2) They have points sampled at the same x position
		// 3) They are the same length (the longest curve is truncated)
		var limit = Math.min(c1.x[c1.x.length-1], c2.x[c2.x.length-1]);
		var positionx = (c1.x.concat(c2.x.filter((item) => c1.x.indexOf(item) < 0))).sort();
		positionx = positionx.filter((item) => item <= limit);

		curve1 = resampleAtGivenPos(c1, positionx);
		curve2 = resampleAtGivenPos(c2, positionx);

		// We compute the area between the curves by adding the areas of all the quadrilaterals that we can form
		var area = 0;
		for (var i = 1; i < curve1.x.length; ++i) {
			var a = {x: curve1.x[i-1], y: curve1.y[i-1]};
			var b = {x: curve1.x[i], y: curve1.y[i]};
			var c = {x: curve2.x[i], y: curve2.y[i]};
			var d = {x: curve2.x[i-1], y: curve2.y[i-1]};

			// Add the area of the quadrilateral
			area += getQuadrilateralArea(a, b, c, d);
		}

		return area;
	}

	this.getTfFilePath = function(speed, os="Windows", enhanced=false) {
		path = "/counts/all_TFS/osx";
		if (os === "Windows") {
			path = "/counts/all_TFS/windows" + (enhanced? "/epp" : "/no-epp");
		}

		return path + "/f" + speed + ".dat";
	}

	this.parseTfPath = function(tfPath) {
		os = tfPath.includes("osx") ? "osx" : "Windows";
		epp = !tfPath.includes("no-epp");
		speed = tfPath.split("/").slice(-1)[0].replace(".dat", "").replace("f", "")

		return {os: os, epp: epp, speed: speed};	
	}

	this.getTfCounts = function(tfPath) {
		return this.tfCache[tfPath];
	}

	// == Load all available transfer functions on both mac and Windows
	// 11 speeds on Windows (22 if we also count enhanced)
	for (var i = 1; i <= 11; ++i) {
		this.tfPaths.push(this.getTfFilePath(i, "Windows", false));
		this.tfPaths.push(this.getTfFilePath(i, "Windows", true));
	}

	// 10 speeds on macOS
	for (var i = 1; i <= 10; ++i) {
		this.tfPaths.push(this.getTfFilePath(i, "osx"));
	}

	// Initialize the cache
	for (const tfPath of this.tfPaths) {
		this.tfCache[tfPath] = false;
	}
}();