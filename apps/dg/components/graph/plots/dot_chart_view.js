// ==========================================================================
//                          DG.DotChartView
//
//  Author:   William Finzer
//
//  Copyright (c) 2014 by The Concord Consortium, Inc. All rights reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
// ==========================================================================

sc_require('components/graph/plots/chart_view');

/** @class  DG.DotChartView, a plot of dots each placed according to categorical values

 @extends DG.ChartView
 */
DG.DotChartView = DG.ChartView.extend(
    /** @scope DG.DotChartView.prototype */
    {
      displayProperties: ['numPointsInRow', 'overlap'],

      /**
       @property{Number}
       */
      numPointsInRow: 1,

      /**
       @property{Number}
       */
      overlap: 0,

      /**
       * If we're displaying as a barchart, this is how high the slices of a bar are
       * @property {Number}
       */
      barSliceHeight: 0,

      /**
       Note: There's a lot of redundancy here with plotLayer::dataDidChange. But it's difficult to
       refactor further because of the need to deal with positioning points via
       privSetCircleCoords.
       */
      updateElements: function () {
        // It's possible to get here before didCreateLayer() creates the get('paper').
        if (!this.get('paper'))
          return;
        sc_super();
        var this_ = this,
            tModel = this.get('model'),
            tCases = this.getPath('model.cases'),
            tRC = this.createRenderContext(),
            tDataLength = tCases && tCases.length,
            tPlotElementLength = this._plottedElements.length,
            tCandidateRadius = this.calcPointRadius(),
            tWantNewPointRadius = (this._pointRadius !== tCandidateRadius),
            tLayerManager = this.get('layerManager'),
            tIndex, tCellIndices;
        // update the point radius before creating or updating plotted elements
        if (tWantNewPointRadius)
          this._pointRadius = tCandidateRadius;

        // for any new cases
        if (tDataLength > tPlotElementLength) {
          if (tWantNewPointRadius) {
            // update the point radius for existing plotted elements
            for (tIndex = 0; tIndex < tPlotElementLength; tIndex++) {
              tCellIndices = tModel.lookupCellForCaseIndex(tIndex);
              // tCellIndices may come out null if the case has empty values
              // Note that we don't animate here because things can happen during the
              // animation that change the destination.
              this.privSetCircleCoords(tRC, tCases[tIndex], tIndex, tCellIndices);
            }
          }
          // add plot elements for added cases
          for (tIndex = tPlotElementLength; tIndex < tDataLength; tIndex++) {
            this.callCreateElement(tCases[tIndex], tIndex, this.animationIsAllowable());
            tCellIndices = tModel.lookupCellForCaseIndex(tIndex);
            this.privSetCircleCoords(tRC, tCases[tIndex], tIndex, tCellIndices);
          }
        }
        // Get rid of plot elements for removed cases and update all coordinates
        if (tDataLength < tPlotElementLength) {
          for (tIndex = tDataLength; tIndex < tPlotElementLength; tIndex++) {
            // It can happen during closing of a document that the elements no longer exist, so we have to test
            if (!SC.none(this._plottedElements[tIndex])) {
              this._plottedElements[tIndex].stop();
              tLayerManager.removeElement(this._plottedElements[tIndex]);
              DG.PlotUtilities.doHideRemoveAnimation(this._plottedElements[tIndex]);
            }
          }
          this._plottedElements.length = tDataLength;
          // update all coordinates because we don't know which cases were deleted
          tCases.forEach(function (iCase, iIndex) {
            tCellIndices = tModel.lookupCellForCaseIndex(iIndex);
            this_.privSetCircleCoords(tRC, iCase, iIndex, tCellIndices);
          });
        }
        this._isRenderingValid = false;
      },

      dataRangeDidChange: function (iSource, iQuestion, iKey, iChanges) {
        var this_ = this,
            tCases = this.getPath('model.cases'),
            tRC = this.createRenderContext(),
            tChanges = (SC.typeOf(iChanges) === SC.T_NUMBER ? [iChanges] : iChanges);
        tChanges = tChanges || [];

        this.model.invalidateCaches();
        this.computeCellParams();

        tChanges.forEach(function (iIndex) {
          // We can get in here after a delete, in which case, iChanges can be referring to
          // a plot element that no longer exists.
          //DG.assert( this_._plottedElements[ iIndex], "dataRangeDidChange: missing plotted element!");
          if (!this_._plottedElements[iIndex])
            this_.callCreateElement(tCases[iIndex], iIndex, this_._createAnimationOn);
          var tCellIndices = this_.get('model').lookupCellForCaseIndex(iIndex);
          this_.privSetCircleCoords(tRC, tCases[iIndex], iIndex, tCellIndices);
        });
        sc_super();
      },

      /**
       * Return the class of the count axis with the x or y to put it on.
       */
      configureAxes: function () {
        var tRet = sc_super(),
            tCountKey = this.getPath('model.orientation') === 'vertical' ? 'y' : 'x';
        tRet = tRet || {};
        tRet.axisKey = tCountKey;
        tRet.axisClass = DG.AxisView; // Dot chart has no numeric scale on the count axis
        return tRet;
      },

      /**
       * Set the coordinates and other attributes of the case circle (a Rafael element in this._plottedElements).
       * @param iRC {} case-invariant Render Context
       * @param iCase {DG.Case} the case data
       * @param iIndex {number} index of case in collection
       * @param iAnimate {Boolean} (optional) want changes to be animated into place?
       * @returns {cx {Number},cy {Number}} final coordinates or null if not defined (hidden plot element)
       */
      setCircleCoordinate: function setCircleCoordinate(iRC, iCase, iIndex, iAnimate, iCallback) {
        var tCellIndices = this.get('model').lookupCellForCaseIndex(iIndex);
        if (this.getPath('model.displayAsBarChart'))
          this.privSetRectCoords(iRC, iCase, iIndex, tCellIndices, iAnimate, iCallback);
        else
          this.privSetCircleCoords(iRC, iCase, iIndex, tCellIndices, iAnimate, iCallback);
      },

      /**
       We set the coordinates of the points.
       Note the tricky computation for secondary coordinate: the 0.5 is to left the center up half a point size.
       the "1" is to lift the center far enough that the circle border doesn't get cut off.
       */
      privSetCircleCoords: function (iRC, iCase, iIndex, iCellIndices, iAnimate, iCallback) {

        DG.assert(iRC && iRC.xAxisView);
        DG.assert(iCase);
        DG.assert(DG.MathUtilities.isInIntegerRange(iIndex, 0, this._plottedElements.length));
        var tElement = this._plottedElements[iIndex],
            tIsMissingCase = SC.none(iCellIndices);

        // show or hide if needed, then update if shown.
        if (this.showHidePlottedElement(tElement, tIsMissingCase)) {
          var tCellHalfWidth = iRC.cellHalfWidth,
              tNumInRow = this.get('numPointsInRow'),
              tOverlap = this.get('overlap'),
              tRow = Math.floor(iCellIndices.indexInCell / tNumInRow),
              tCol = iCellIndices.indexInCell - tRow * tNumInRow,
              tRadius = this._pointRadius,
              tPointSize = 2 * tRadius,
              tPrimaryCoord = iRC.primaryAxisView.cellToCoordinate(iCellIndices.primaryCell) -
                  (tNumInRow - 1) * tPointSize / 2 + tCol * tPointSize,
              tSecondaryCoord = iRC.secondaryAxisView.cellToCoordinate(iCellIndices.secondaryCell),
              tOffset = ((tRow + 0.5) * (tPointSize - tOverlap) + 1 + tOverlap / 2),
              tCoordX, tCoordY;

          DG.assert(DG.isFinite(tPrimaryCoord) && DG.isFinite(tSecondaryCoord), 'tPrimaryCoord & tSecondaryCoord');

          if (iRC.isVerticalOrientation) {
            tCoordX = tPrimaryCoord;
            tCoordY = tSecondaryCoord + tCellHalfWidth - tOffset;
          }
          else {
            tCoordX = tSecondaryCoord - tCellHalfWidth + tOffset;
            tCoordY = tPrimaryCoord;
          }
          DG.assert(isFinite(tCoordX) && isFinite(tCoordY));

          var tAttrs = {
            cx: tCoordX, cy: tCoordY, r: this.radiusForCircleElement(tElement),
            fill: iRC.calcCaseColorString(iCase), stroke: iRC.strokeColor,
            'fill-opacity': iRC.transparency, 'stroke-opacity': iRC.strokeTransparency
          };
          this.updatePlottedElement(tElement, tAttrs, iAnimate, iCallback);
        }
      },

      /**
       * @param iCase
       * @param iIndex
       * @param iAnimate
       */
      createElement: function (iCase, iIndex, iAnimate) {
        // Can't create circles if we don't have paper for them
        if (!this.get('paper')) return;

        var this_ = this,
            tInitialTransform = null,
            kOpaque = 1,
            tCircle = this.get('paper').circle(0, 0, this._pointRadius)
        // Note: we have to set cx and cy offscreen here rather than in creation because for some unknown
        // reason, when we do it in creation, they end up zero rather than offscreen.
            .attr({
              cursor: "pointer", cx: -1000, cy: -1000
            })
            .addClass(DG.PlotUtilities.kColoredDotClassName)
            .hover(function (event) {
                  // Note that Firefox can come through here repeatedly so we have to check for existence
                  if (SC.none(tInitialTransform)) {
                    tInitialTransform = '';
                    this.animate({
                      opacity: kOpaque,
                      transform: DG.PlotUtilities.kDataHoverTransform
                    }, DG.PlotUtilities.kDataTipShowTime);
                    this_.showDataTip(this, iIndex);
                  }
                },
                function (event) { // out
                  this.stop();
                  this.animate({
                    opacity: DG.PlotUtilities.kDefaultPointOpacity,
                    transform: tInitialTransform
                  }, DG.PlotUtilities.kHighlightHideTime);
                  tInitialTransform = null;
                  this_.hideDataTip();
                })
            .mousedown(function (iEvent) {
              SC.run(function () {
                this_.get('model').selectCaseByIndex(iIndex, iEvent.shiftKey);
              });
            });
        tCircle.index = iIndex;
        tCircle.node.setAttribute('shape-rendering', 'geometric-precision');
        if (iAnimate)
          DG.PlotUtilities.doCreateCircleAnimation(tCircle);
        return tCircle;
      },

      /**
       Only recreate elements if necessary. Otherwise, just set svg element coordinates.
       */
      drawData: function drawData() {
        if (SC.none(this.get('paper')))
          return; // not ready to draw
        if (this.getPath('model.isAnimating'))
          return; // Points are animating to new position

        if (!SC.none(this.get('transferredElementCoordinates'))) {
          this.animateFromTransferredElements();
          return;
        }

        var this_ = this,
            tModel = this.get('model'),
            tCases = tModel.get('cases'),
            tRC = this.createRenderContext(),
            tPlotElementLength = this._plottedElements.length,
            tLayerManager = this.get('layerManager'),
            tIndex;

        if (!tCases)
          return; // We can get here before things are linked up during restore

        this._pointRadius = this.calcPointRadius(); // make sure created circles are of right size
        if (this._mustCreatePlottedElements) {
          this.removePlottedElements();
          tCases.forEach(this.callCreateElement, this);
          this._mustCreatePlottedElements = false;
        }

        this.computeCellParams();

        for (tIndex = tCases.length; tIndex < tPlotElementLength; tIndex++) {
          DG.PlotUtilities.doHideRemoveAnimation(this._plottedElements[tIndex], tLayerManager);
        }
        if (tCases.length < tPlotElementLength) { // remove from array
          tPlotElementLength = this._plottedElements.length = tCases.length;
        }

        tCases.forEach(function (iCase, iIndex) {
          var tCellIndices = tModel.lookupCellForCaseIndex(iIndex);
          if (iIndex >= tPlotElementLength)
            this_.callCreateElement(iCase, iIndex);

          this_.privSetCircleCoords(tRC, iCase, iIndex, tCellIndices);
        });

        this.updateSelection();
      },

      /**
       We override the base class implementation
       */
      animateFromTransferredElements: function () {
        var this_ = this,
            tModel = this.get('model'),
            tCases = tModel.get('cases'),
            tRC = this.createRenderContext(),
            tFrame = this.get('frame'), // to convert from parent frame to this frame
            tOldElementAttrs = this.get('transferredElementCoordinates'),
            tNewElementAttrs = [], // used if many-to-one animation (parent to child collection)
            tNewToOldCaseMap = [],
            tOldToNewCaseMap = [];
        if (!tCases)
          return;

        function turnOffAnimation() {
          tModel.set('isAnimating', false);
          this_.displayDidChange(); // Force redisplay in correct position
        }

        function caseLocationSimple(iIndex) {
          // assume a 1 to 1 correspondence of the current case indices to the new cases
          return tOldElementAttrs[iIndex];
        }

        function caseLocationViaMap(iIndex) {
          // use our case index map to go from current case index to previous case index
          return tOldElementAttrs[tNewToOldCaseMap[iIndex]];
        }

        DG.sounds.playMixup();
        this._getTransferredElementsToCasesMap(tNewToOldCaseMap, tOldToNewCaseMap);
        var hasElementMap = tNewToOldCaseMap.length > 0,
            hasVanishingElements = tOldToNewCaseMap.length > 0,
            getCaseCurrentLocation = (hasElementMap ? caseLocationViaMap : caseLocationSimple),
            tTransAttrs;

        this.prepareToResetCoordinates();
        this.removePlottedElements();
        this.computeCellParams();
        tOldElementAttrs.forEach(function (iElement, iIndex) {
          // adjust old coordinates from parent frame to this view
          iElement.cx -= tFrame.x;
          iElement.cy -= tFrame.y;
        });
        tCases.forEach(function (iCase, iIndex) {
          var tCurrAttrs = getCaseCurrentLocation(iIndex),
              tCellIndices = tModel.lookupCellForCaseIndex(iIndex),
              tNewElement = this_.callCreateElement(iCase, iIndex, false);
          if (!SC.none(tCurrAttrs)) {
            tTransAttrs = {
              r: !SC.none(tCurrAttrs.r) ? tCurrAttrs.r : 0,
              cx: !SC.none(tCurrAttrs.cx) ? tCurrAttrs.cx : tCurrAttrs.x,
              cy: !SC.none(tCurrAttrs.cy) ? tCurrAttrs.cy : tCurrAttrs.y,
              fill: tCurrAttrs.fill,
              stroke: tCurrAttrs.stroke
            };
            tNewElement.attr(tTransAttrs);
          }
          this_.privSetCircleCoords(tRC, iCase, iIndex, tCellIndices, true /* animate */);
          if (hasVanishingElements) {
            tNewElementAttrs.push(tCurrAttrs);
          }
        });
        if (hasVanishingElements) {
          // create a vanishing element for each old point that needs one (used if many-to-one animation)
          tOldElementAttrs.forEach(function (iOldAttrs, iIndex) {
            var tNewIndex = tOldToNewCaseMap[iIndex],
                tNewAttrs = tNewElementAttrs[tNewIndex];
            if (SC.none(tNewIndex) || SC.none(tNewAttrs) || (iOldAttrs.r === 0))
              return; // no vanishing element, if (1) element persists or (2) new circle hidden or (3) old circle hidden
            this_.vanishPlottedElement(iOldAttrs, tNewAttrs);
          });
        }
        this._mustCreatePlottedElements = false;  // because we just created them
        this.set('transferredElementCoordinates', null);

        tModel.set('isAnimating', true);
        SC.Timer.schedule({action: turnOffAnimation, interval: DG.PlotUtilities.kDefaultAnimationTime});
      },

      /**
       We need to decide on the number of points in a row. To do so, we find the
       maximum number of points in a cell and choose so that this max number will
       fit within the length of a cell rect. If there are so many points that they don't fit
       even by using the full length of a cell rect, then we compute an overlap.
       */
      computeCellParams: function () {
        var tCellWidth = this.getPath('primaryAxisView.cellWidth'),
            tCellHeight = this.getPath('secondaryAxisView.fullCellWidth') - 5,
            tMaxInCell = this.getPath('model.maxInCell'),
            tPointSize = 2 * this._pointRadius,
            tAllowedPointsPerColumn = Math.max(1, Math.floor(tCellHeight / tPointSize)),
            tAllowedPointsPerRow = Math.max(1, Math.floor(tCellWidth / tPointSize)),
            tNumPointsInRow = Math.max(1,
                Math.min(tAllowedPointsPerRow,
                    Math.ceil(tMaxInCell / tAllowedPointsPerColumn))),
            tActualPointsPerColumn = Math.ceil(tMaxInCell / tNumPointsInRow),
            tOverlap = Math.max(0, ((tActualPointsPerColumn + 1) * tPointSize - tCellHeight) /
                tActualPointsPerColumn),
            tBarSliceHeight = tCellHeight / tMaxInCell;
        tOverlap = Math.min(tOverlap, tPointSize); // Otherwise points can stack downward

        // Note: Bill points out that 1 is a better default here, but using 1 doesn't fix the bug
        // I'm working on. This may have to do with making sure a notification goes out when
        // 'numPointsInRow' later changes to 1 when the chart becomes valid.
        if (!isFinite(tNumPointsInRow))
          tNumPointsInRow = 0;
        if (!isFinite(tOverlap))
          tOverlap = 0;

        this.beginPropertyChanges();
        this.setIfChanged('numPointsInRow', tNumPointsInRow);
        this.setIfChanged('overlap', tOverlap);
        this.setIfChanged('barSliceHeight', tBarSliceHeight);
        this.endPropertyChanges();
      }

    });

