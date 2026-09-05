var bgcolorlist = ["default", "theme1", "theme2", "theme3", "theme4", "theme5"];
if (classVal !== null && classVal !== undefined && classVal !== "") {
    bgcolorlist.splice(bgcolorlist.indexOf(classVal), 1);
    bgcolorlist.splice(0, 0, classVal)
}
var ReadSet = {
    bgcolor: bgcolorlist,
    bgvalue: classVal,
    fontsvalue: 24,
    pageid: "apage",
    textid: "chaptercontent",
    SetBgcolor: function(color) {
        document.getElementsByTagName("html")[0].setAttribute("class", color);
        setCookies("bgcolor", color, 1);
        this.bgvalue = color
    },
    SetFontsize: function(size) {
        document.getElementById(this.textid).style.fontSize = size + "px";
        setCookies("fontsize", size, 1);
        this.fontsvalue = size
    },
    SetFontsize1: function() {
        this.fontsvalue -= 2;
        if (this.fontsvalue < 14)
            this.fontsvalue = 14;
        this.SetFontsize(this.fontsvalue)
    },
    SetFontsize2: function() {
        this.fontsvalue += 2;
        if (this.fontsvalue > 36)
            this.fontsvalue = 36;
        this.SetFontsize(this.fontsvalue)
    },
    Show: function() {
        var output;
        output = '<div class="settheme">';
        for (i = 0; i < this.bgcolor.length; i++) {
          output += '<a class="' + this.bgcolor[i] + '" onclick="ReadSet.SetBgcolor(\'' + this.bgcolor[i] + '\')" href="javascript:;"></a>';
        }
        output += '</div><div class="setfont">';
        output += '<a onclick="ReadSet.SetFontsize1()" href="javascript:;">小</a>';
        output += '<a onclick="ReadSet.SetFontsize(24)" href="javascript:;">默认</a>';
        output += '<a onclick="ReadSet.SetFontsize2()" href="javascript:;">大</a>';
        output += "</div>";
        document.getElementById("readSet").innerHTML = output
    },
    SaveSet: function() {
        setCookies("bgcolor", this.bgvalue, 1);
        setCookies("fontsize", this.fontsvalue, 1)
    },
    LoadSet: function() {
        tmpstr = readCookies("bgcolor", 1);
        if (tmpstr)
            this.bgvalue = tmpstr;
        this.SetBgcolor(this.bgvalue);
        tmpstr2 = readCookies("fontsize", 1);
        if (tmpstr2)
            this.fontsvalue = Number(tmpstr2);
        this.SetFontsize(this.fontsvalue)
    }
};
ReadSet.Show();
function LoadReadSet() {
    ReadSet.LoadSet()
}
if (window.attachEvent) {
    window.attachEvent("onload", LoadReadSet)
} else {
    window.addEventListener("load", LoadReadSet, false)
}