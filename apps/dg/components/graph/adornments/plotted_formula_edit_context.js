// ==========================================================================
//                      DG.PlottedFormulaEditContext
//
//  Author:   Kirk Swenson
//
//  Copyright (c) 2017 by The Concord Consortium, Inc. All rights reserved.
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

DG.PlottedFormulaEditContext = SC.Object.extend({

  plottedFormula: null,

  expressionBinding: '.plottedFormula.expression',

  formulaView: null,

  formulaDialog: null,

  createFormulaView: function(iOptions) {
    var formulaContext = this,
        formulaLabel = iOptions.formulaPrompt,
        formulaView = DG.FormulaTextEditView.create({
                        layout: { height: 20 },
                        borderStyle: SC.BORDER_BEZEL,
                        isVisible: false,
                        isEditable: false,
                        value: formulaContext.getPath('plottedFormula.expression'),
                        leftAccessoryView: SC.LabelView.create({
                          layout: { left: 0, width:45, height:20, centerY: 0 },
                          value: formulaLabel ? "\xA0" + formulaLabel : "",
                          backgroundColor: 'gray'
                        }),
                        desiredExtent: 20,
                        mouseDown: function(evt) {
                          formulaContext.openFormulaEditorDialog();
                        }
                      });
    this.set('formulaView', formulaView);
    this.set('clientOptions', iOptions ? DG.copy(iOptions) : {});
    this.openFormulaEditorDialog();
    return formulaView;
  },

  openFormulaEditorDialog: function() {
    var formulaContext = this,
        dataContext = this.getPath('plottedFormula.plotModel.dataContext'),
        result = DG.AttributeFormulaView.buildOperandsMenuAndCompletionData(dataContext),
        clientOptions = this.get('clientOptions'),
        options = Object.assign({
                    applyTarget: formulaContext,
                    applyAction: 'applyNewFormula',
                    attrNamePrompt: 'DG.PlottedFormula.defaultNamePrompt'.loc(),
                    attrNameValue: "",
                    attrNameIsEnabled: false,
                    formulaValue: formulaContext.get('expression'),
                    formulaCompletions: result.completionData,
                    formulaOperands: result.operandsMenu
                  }, clientOptions),
        formulaDialog = DG.CreateAttributeFormulaView(options);
    this.set('formulaDialog', formulaDialog);
    return formulaDialog;
  },

  createEditCommand: function(newFormula) {
    var clientOptions = this.get('clientOptions'),
        originalFormula = this.get('expression');

    var setFormula = function setFormula(formula) {
      this.set('expression', formula);
      this.setPath('formulaView.value', formula);
    }.bind(this);

    return DG.Command.create({
      name: clientOptions.commandName,
      undoString: clientOptions.undoString,
      redoString: clientOptions.redoString,
      log: clientOptions.logMessage &&
            clientOptions.logMessage.fmt(originalFormula, newFormula),
      execute: function() {
        setFormula(newFormula);
      },
      undo: function() {
        setFormula(originalFormula);
      },
      redo: function() {
        setFormula(newFormula);
      }
    });
  },

  applyNewFormula: function() {
    var cmd = this.createEditCommand(this.getPath('formulaDialog.formula'));
    DG.UndoHistory.execute(cmd);

    var dialog = this.get('formulaDialog');
    if (dialog) {
      dialog.close();
      this.set('formulaDialog', null);
    }
  }
});

DG.PlottedFormulaEditContext.formulaEditContexts = {};

DG.PlottedFormulaEditContext.getFormulaEditContext = function(iPlottedFormula) {
  var adornmentID = iPlottedFormula.get('id');
  if (!DG.PlottedFormulaEditContext.formulaEditContexts[adornmentID]) {
    DG.PlottedFormulaEditContext.formulaEditContexts[adornmentID] =
      DG.PlottedFormulaEditContext.create({ plottedFormula: iPlottedFormula });
  }
  return DG.PlottedFormulaEditContext.formulaEditContexts[adornmentID];
};

