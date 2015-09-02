/** @jsx React.DOM */
var React = require('react');
var Ace = require('brace');
var TabsStore = require('./TabsStore');
var Actions = require('./Actions');
var History = require('./History');
var fs = require('fs');

require('brace/mode/pgsql');
require('brace/theme/chrome');
require('brace/theme/idle_fingers');
require('brace/keybinding/vim');

var Editor = React.createClass({

    getInitialState: function(){
        if (TabsStore.tmpScript != null){
            var script = TabsStore.tmpScript;
            TabsStore.tmpScript = null;
        } else {
            var script = null;
        }
        return {
            theme: TabsStore.getEditorTheme(), 
            mode: TabsStore.getEditorMode(),
            script: script,
        };
    },

    componentDidMount: function(){
        this.editor = Ace.edit(this.props.name);
        this.editor.getSession().setMode('ace/mode/pgsql');
        this.editor.setTheme('ace/theme/' + this.state.theme);
        this.editor.setKeyboardHandler(this.state.mode);
        TabsStore.bind('change', this.changeHandler);
        TabsStore.bind('editor-resize', this.resize);
        TabsStore.bind('change-theme', this.changeHandler);
        TabsStore.bind('change-mode', this.changeHandler);
        TabsStore.bind('open-file-'+this.props.eventKey, this.fileOpenHandler);
        TabsStore.bind('save-file-'+this.props.eventKey, this.fileSaveHandler);
        TabsStore.bind('execute-script-'+this.props.eventKey, this.execHandler);
        TabsStore.bind('execute-block-'+this.props.eventKey, this.execBlockHandler);
        TabsStore.bind('execute-all-'+this.props.eventKey, this.execAllHandler);
        TabsStore.bind('editor-find-next', this.findNext);
        TabsStore.bind('object-info-'+this.props.eventKey, this.objectInfoHandler);
        TabsStore.bind('paste-history-item-'+this.props.eventKey, this.pasteHistoryHandler);

        this.editor.commands.addCommand({
            name: "find",
            bindKey: {
                win: "Ctrl-F",
                mac: "Command-F"
            },
            exec: function(editor, line) {
                Actions.toggleFindBox();
            },
            readOnly: true
        });

        this.editor.commands.addCommand({
            name: "history",
            bindKey: {
                win: "Ctrl-H",
                mac: "Command-Y"
            },
            exec: function(editor, line) {
                Actions.toggleHistory();
            },
            readOnly: true
        });

        this.editor.commands.addCommand({
            name: "exec all",
            bindKey: {
                win: "Ctrl-Shift-E",
                mac: "Command-Shift-E"
            },
            exec: function(editor, line) {
                Actions.execAll();
            },
            readOnly: true
        });

        this.editor.getSelectedText = function() { 
            return this.session.getTextRange(this.getSelectionRange());
        }

        if (this.state.script != null){ // load script
            this.editor.session.setValue(this.state.script, -1);
        }
        this.editor.focus();
    },

    componentWillUnmount: function(){
        TabsStore.unbind('change', this.changeHandler);
        TabsStore.unbind('editor-resize', this.resize);
        TabsStore.unbind('change-theme', this.changeTheme);
        TabsStore.unbind('change-mode', this.changeMode);
        TabsStore.unbind('open-file-'+this.props.eventKey, this.fileOpenHandler);
        TabsStore.unbind('save-file-'+this.props.eventKey, this.fileSaveHandler);
        TabsStore.unbind('execute-script-'+this.props.eventKey, this.execHandler);
        TabsStore.unbind('execute-block-'+this.props.eventKey, this.execBlockHandler);
        TabsStore.unbind('execute-all-'+this.props.eventKey, this.execAllHandler);
        TabsStore.unbind('editor-find-next', this.findNext);
        TabsStore.unbind('object-info-'+this.props.eventKey, this.objectInfoHandler);
        TabsStore.unbind('paste-history-item-'+this.props.eventKey, this.pasteHistoryHandler);
    },

    execHandler: function(editor) {
        var selected = this.editor.getSelectedText();
        if (selected) {
            var script = selected;
        } else {
            var script = this.editor.getValue();
        }
        Actions.runQuery(this.props.eventKey, script);
    },

    execBlockHandler: function(){
        var selected = this.editor.getSelectedText()
        if (selected) {
            var script = selected;
        } else {
            var current_line = this.editor.selection.getCursor().row;
            var script = this.detectBlock(current_line, this.editor.getValue);
        }
        Actions.runQuery(this.props.eventKey, script);

    },

    execAllHandler: function(){
        var meta = '^\s*---\s*.*';
        var current_line = 0;
        var blocks = [];
        var block = [];
        while (current_line < this.editor.session.getLength()){
            current_line_text = this.editor.session.getLine(current_line).trim();
            if (current_line > 0 && current_line_text.match(meta) != null){ // new block started
                blocks.push(block.join('\n'));
                block = [];
            }
            block.push(current_line_text);
            current_line++;
        }

        if (block.length > 0){ // append last block if any remained
            blocks.push(block.join('\n'));
        }

        Actions.runAllBlocks(this.props.eventKey, blocks);
    },

    detectBlock: function(current_line, script){
        var meta = '^\s*---\s*.*';
        var start = 0;
        var start_found = false;
        while (!start_found){
            current_line_text = this.editor.session.getLine(current_line).trim();
            if (current_line === 0) {
                start = current_line;
                start_found = true;
            } else if (current_line_text.match(meta) != null){
                start = current_line;
                start_found = true;
            } 
            current_line--;
        }
        
        var end = null;
        var end_found = false;
        current_line = start;
        while (!end_found){
            current_line_text = this.editor.session.getLine(current_line).trim();
            if (current_line_text.match(meta) != null && current_line > start){
                end = current_line - 1;
                end_found = true;
            } else if (current_line >= this.editor.session.getLength()){
                end = current_line - 1;
                end_found = true;
            }
            current_line++; 
        }
        
        return this.editor.session.getLines(start, end).join('\n');
    },

    changeHandler: function(){
        this.setState({
            theme: TabsStore.getEditorTheme(),
            mode: TabsStore.getEditorMode(),
        });
        this.editor.setTheme('ace/theme/' + this.state.theme);
        this.editor.setKeyboardHandler(this.state.mode);
        this.editor.resize();
        this.editor.focus();
    },

    fileOpenHandler: function(){
        filename = TabsStore.getEditorFile(this.props.eventKey);

        self = this;
        fd = fs.readFile(filename, 'utf8', function(err, data){
            if (err){
                console.log(err);
            } else {
                self.editor.session.setValue(data, -1);
            }
        });

    },

    fileSaveHandler: function(){
        filename = TabsStore.getEditorFile(this.props.eventKey);
        fs.writeFile(filename, this.editor.getValue(), function(err) {
            if(err) {
                return console.log(err);
            }
        }); 
    },

    findNext: function(){

        var init_position = this.editor.getCursorPosition();
        var value = TabsStore.getSearchValue();
        var ret = this.editor.find(value ,{
          backwards: false,
          wrap: false,
          caseSensitive: false,
          wholeWord: false,
          regExp: false,
          start: 0,
        });

        if (typeof(ret) == 'undefined'){ // start from the beginning in case of end of file
            this.editor.gotoLine(0, 0, true);
            var ret = this.editor.find(value ,{
              backwards: false,
              wrap: false,
              caseSensitive: false,
              wholeWord: false,
              regExp: false,
              start: 0,
            });

            if (typeof(ret) == 'undefined'){ // if nothing found
                this.editor.gotoLine(init_position.row+1, init_position.column, false); 
            }
        }
    },

    objectInfoHandler: function(){
        // detect object under cursor
        var pos = this.editor.getCursorPosition();
        var line_text = this.editor.session.getLine(pos.row);
        var part1 = line_text.substring(0, pos.column);
        part1 = part1.match("[A-z0-9.]*$"); 
        if (part1 != null){
            part1 = part1[0]
        } else {
            part1 = ""
        }

        var part2 = line_text.substring(pos.column);
        part2 = part2.match("^[A-z0-9.]+"); 
        if (part2 != null){
            part2 = part2[0]
        } else {
            part2 = ""
        }

        var object = part1 + part2;
        Actions.getObjectInfo(object);
    },

    pasteHistoryHandler: function(){
        var item = History.get(TabsStore.getHistoryItem());
        if (item != null){
            var position = this.editor.getCursorPosition();
            this.editor.getSession().insert(position, item.query);
        }
    },

    resize: function(){
        this.editor.resize();
    },

    render: function(){
        return (
            <div id={this.props.name} mode={this.state.mode}/>
        );
    },
});

module.exports= Editor;
